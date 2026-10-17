import { type DataSource, type EntityManager, In, MoreThan } from 'typeorm';
import { ACTIVE_JOB_STATES, PrintJob } from './entities/PrintJob.js';

/** Length of the window the hourly cap counts jobs in. */
const CAP_WINDOW_MS = 60 * 60 * 1000;

export interface IntakeInput {
	/** The Drive link as submitted. */
	url: string;
	/** File ID parsed from `url`. */
	driveFileId: string;
	/** Most jobs that may be created in any one-hour window (integer >= 1). */
	maxJobsPerHour: number;
	/** Current time; defaults to `new Date()`. */
	now?: Date;
}

/**
 * Outcome of `intakeJob`:
 * - `created`: a new `queued` job (`202`).
 * - `existing`: a job for the same Drive file is still `queued`/`processing` (`200`).
 * - `rate-limited`: the hourly cap is reached (`429`); retry after this many seconds.
 */
export type IntakeResult =
	| { kind: 'created'; id: number }
	| { kind: 'existing'; id: number }
	| { kind: 'rate-limited'; retryAfterSeconds: number };

/**
 * Records a print request — the single authority for dedupe and the hourly cap.
 *
 * In one transaction it:
 * 1. returns the active (`queued`/`processing`) job for the same `driveFileId`
 *    if there is one, so a retried request never counts toward the cap;
 * 2. otherwise refuses once `maxJobsPerHour` jobs were created in the last hour,
 *    with the seconds until the oldest of them ages out (rounded up, min 1);
 * 3. otherwise inserts a `queued` job with `nextAttemptAt = now`.
 *
 * If the insert hits the partial unique index (another writer queued the same
 * file first), the active job is re-read after the rollback and returned as
 * `existing`. Any other error propagates.
 */
export function intakeJob(dataSource: DataSource, input: IntakeInput): Promise<IntakeResult> {
	return runIntake(dataSource, input);
}

/** @internal Test seam: `skipDedupeLookup` simulates losing the insert race. */
export function runIntake(
	dataSource: DataSource,
	input: IntakeInput,
	options: { skipDedupeLookup?: boolean } = {}
): Promise<IntakeResult> {
	const { url, driveFileId, maxJobsPerHour } = input;
	const now = input.now ?? new Date();
	if (!Number.isInteger(maxJobsPerHour) || maxJobsPerHour < 1) {
		throw new RangeError(`maxJobsPerHour must be an integer >= 1, got ${maxJobsPerHour}`);
	}

	return serialised(dataSource, async () => {
		try {
			return await inImmediateTransaction(dataSource, async (manager) => {
				if (!options.skipDedupeLookup) {
					const active = await findActiveJobId(manager, driveFileId);
					if (active !== null) return { kind: 'existing', id: active };
				}

				const retryAfterSeconds = await checkHourlyCap(manager, maxJobsPerHour, now);
				if (retryAfterSeconds !== null) return { kind: 'rate-limited', retryAfterSeconds };

				const inserted = await manager.insert(PrintJob, {
					url,
					driveFileId,
					state: 'queued',
					attempts: 0,
					nextAttemptAt: now,
					createdAt: now,
					updatedAt: now
				});
				return { kind: 'created', id: inserted.identifiers[0].id as number };
			});
		} catch (err) {
			if (!isUniqueConstraintError(err)) throw err;
			// The transaction is rolled back; re-read in a fresh query.
			const active = await findActiveJobId(dataSource.manager, driveFileId);
			if (active === null) throw err;
			return { kind: 'existing', id: active };
		}
	});
}

async function findActiveJobId(
	manager: EntityManager,
	driveFileId: string
): Promise<number | null> {
	const job = await manager.findOne(PrintJob, {
		select: { id: true },
		where: { driveFileId, state: In([...ACTIVE_JOB_STATES]) }
	});
	return job?.id ?? null;
}

/** Returns `retryAfterSeconds` if the cap is reached, else `null`. */
async function checkHourlyCap(
	manager: EntityManager,
	maxJobsPerHour: number,
	now: Date
): Promise<number | null> {
	const inWindow = { createdAt: MoreThan(new Date(now.getTime() - CAP_WINDOW_MS)) };
	const count = await manager.count(PrintJob, { where: inWindow });
	if (count < maxJobsPerHour) return null;

	const oldest = await manager.findOneOrFail(PrintJob, {
		select: { id: true, createdAt: true },
		where: inWindow,
		order: { createdAt: 'ASC', id: 'ASC' }
	});
	const msUntilAgedOut = oldest.createdAt.getTime() + CAP_WINDOW_MS - now.getTime();
	return Math.max(1, Math.ceil(msUntilAgedOut / 1000));
}

/** better-sqlite3's code, either raw or wrapped by TypeORM's `QueryFailedError`. */
function isUniqueConstraintError(err: unknown): boolean {
	const codeOf = (value: unknown): unknown =>
		typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined;
	const driverError =
		typeof err === 'object' && err !== null && 'driverError' in err ? err.driverError : undefined;
	return (
		codeOf(err) === 'SQLITE_CONSTRAINT_UNIQUE' || codeOf(driverError) === 'SQLITE_CONSTRAINT_UNIQUE'
	);
}

/**
 * Runs `work` in a `BEGIN IMMEDIATE` transaction, which takes the write lock up
 * front (waiting up to the busy timeout) so another process committing between
 * our reads and the insert can't fail the transaction with `SQLITE_BUSY`.
 *
 * TypeORM's own `transaction()` only issues a deferred `BEGIN`, hence the manual
 * statements. The better-sqlite3 driver shares one connection per data source,
 * so callers must not start another transaction on it concurrently; `serialised`
 * guarantees that for intake.
 */
async function inImmediateTransaction<T>(
	dataSource: DataSource,
	work: (manager: EntityManager) => Promise<T>
): Promise<T> {
	const runner = dataSource.createQueryRunner();
	await runner.query('BEGIN IMMEDIATE');
	try {
		const result = await work(runner.manager);
		await runner.query('COMMIT');
		return result;
	} catch (err) {
		await runner.query('ROLLBACK').catch(() => undefined);
		throw err;
	}
}

const queues = new WeakMap<DataSource, Promise<unknown>>();

/** Runs intakes on the same data source one at a time. */
function serialised<T>(dataSource: DataSource, task: () => Promise<T>): Promise<T> {
	const run = (queues.get(dataSource) ?? Promise.resolve()).then(task);
	queues.set(
		dataSource,
		run.catch(() => undefined)
	);
	return run;
}
