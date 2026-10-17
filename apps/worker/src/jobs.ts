/**
 * One worker tick: claim the oldest due job, attempt it, record the outcome.
 *
 * An attempt is: Drive metadata → size cap → handler lookup → download to a
 * private temp directory → handler → `lp`. Success marks the job `printed`
 * with its CUPS job id. Any error counts as a failed attempt: a
 * `PermanentJobError` (oversized file, unsupported type) fails the job at
 * once; anything else goes through the shared retry policy.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	computeRetry,
	type DriveClient,
	getHandler,
	type JobState,
	PermanentJobError,
	PrintJob
} from '@print-me/shared';
import { type DataSource, LessThanOrEqual } from 'typeorm';
import { type LpSubmission, submitToCups } from './lp.js';

/** Longest `lastError` stored on a job. */
export const MAX_ERROR_LENGTH = 500;

export interface WorkerDeps {
	dataSource: DataSource;
	drive: DriveClient;
	/** CUPS queue name (`CUPS_PRINTER_NAME`). */
	printer: string;
	/** Largest Drive file accepted, in bytes (`MAX_FILE_BYTES`). */
	maxFileBytes: number;
	/** Submits a prepared file to CUPS; defaults to the `lp` helper. */
	submit?: (submission: LpSubmission) => Promise<string>;
	/** Clock; defaults to `new Date()`. */
	now?: () => Date;
	log?: (message: string) => void;
}

/** A job the tick handled and the state it ended the tick in. */
export interface TickResult {
	id: number;
	state: JobState;
}

/**
 * Returns jobs left in `processing` (the worker died mid-attempt) to `queued`.
 * Safe only because this is the sole worker; call it once at startup.
 *
 * @returns how many jobs were reset.
 */
export async function resetInterruptedJobs(dataSource: DataSource): Promise<number> {
	const result = await dataSource
		.getRepository(PrintJob)
		.update({ state: 'processing' }, { state: 'queued' });
	return result.affected ?? 0;
}

/**
 * Handles at most one job: the oldest `queued` job whose `nextAttemptAt` has
 * passed. Errors from the attempt are recorded on the job, not thrown.
 *
 * @returns the job handled and its new state, or `null` if none was due.
 */
export async function runTick(deps: WorkerDeps): Promise<TickResult | null> {
	const clock = deps.now ?? (() => new Date());
	const log = deps.log ?? (() => undefined);

	const job = await claimNextDueJob(deps.dataSource, clock());
	if (!job) return null;
	log(`job=${job.id} claimed attempt=${job.attempts + 1} driveFileId=${job.driveFileId}`);

	const seen: AttemptContext = { mimeType: null };
	try {
		const cupsJobId = await attempt(job, deps, seen, log);
		log(`job=${job.id} printed cupsJobId=${cupsJobId}`);
		return { id: job.id, state: 'printed' };
	} catch (error) {
		const state = await recordFailure(deps.dataSource, job, error, seen, clock());
		log(`job=${job.id} attempt failed state=${state}: ${errorMessage(error)}`);
		return { id: job.id, state };
	}
}

/**
 * Finds the oldest due job and moves it to `processing` before any work. The
 * conditional UPDATE only succeeds while the row is still `queued`, so a job
 * is never claimed twice.
 */
async function claimNextDueJob(dataSource: DataSource, now: Date): Promise<PrintJob | null> {
	const repo = dataSource.getRepository(PrintJob);
	const job = await repo.findOne({
		where: { state: 'queued', nextAttemptAt: LessThanOrEqual(now) },
		order: { createdAt: 'ASC', id: 'ASC' }
	});
	if (!job) return null;

	const claimed = await repo.update({ id: job.id, state: 'queued' }, { state: 'processing' });
	if (claimed.affected !== 1) return null;
	job.state = 'processing';
	return job;
}

/** What an attempt learned before failing, kept on the job for diagnosis. */
interface AttemptContext {
	mimeType: string | null;
}

/** Runs one attempt; on success the job is already marked `printed`. */
async function attempt(
	job: PrintJob,
	deps: WorkerDeps,
	seen: AttemptContext,
	log: (message: string) => void
): Promise<string> {
	const { drive, maxFileBytes, printer } = deps;
	const submit = deps.submit ?? submitToCups;

	const meta = await drive.getMetadata(job.driveFileId);
	seen.mimeType = meta.mimeType;
	if (meta.size !== null && meta.size > maxFileBytes) {
		throw new PermanentJobError(
			`File is ${meta.size} bytes, over the ${maxFileBytes}-byte limit (MAX_FILE_BYTES)`
		);
	}
	const handler = getHandler(meta.mimeType);

	// mkdtemp creates the directory with mode 0700: only the service user can read it.
	const tempDir = await mkdtemp(join(tmpdir(), 'print-me-job-'));
	try {
		const downloadPath = join(tempDir, 'document');
		await drive.downloadToFile(job.driveFileId, downloadPath);
		const prepared = await handler.prepare(downloadPath);
		const cupsJobId = await submit({
			printer,
			filePath: prepared.filePath,
			options: prepared.lpOptions
		});
		// Record the print straight after lp returns: if this update failed, the
		// job would be retried and printed twice (accepted, see AGENTS.md).
		await deps.dataSource.getRepository(PrintJob).update(
			{ id: job.id },
			{
				state: 'printed',
				attempts: job.attempts + 1,
				cupsJobId,
				mimeType: meta.mimeType,
				lastError: null
			}
		);
		return cupsJobId;
	} finally {
		// Never let cleanup turn a finished print into a failed attempt.
		await rm(tempDir, { recursive: true, force: true }).catch((error: unknown) => {
			log(`job=${job.id} could not remove ${tempDir}: ${errorMessage(error)}`);
		});
	}
}

/** Counts the failed attempt and decides whether the job retries or fails. */
async function recordFailure(
	dataSource: DataSource,
	job: PrintJob,
	error: unknown,
	seen: AttemptContext,
	now: Date
): Promise<JobState> {
	const attempts = job.attempts + 1;
	const decision = error instanceof PermanentJobError ? null : computeRetry(attempts, now);
	const retryAt = decision && 'retryAt' in decision ? decision.retryAt : null;
	const state: JobState = retryAt ? 'queued' : 'failed';

	await dataSource.getRepository(PrintJob).update(
		{ id: job.id },
		{
			state,
			attempts,
			lastError: truncate(errorMessage(error), MAX_ERROR_LENGTH),
			...(retryAt ? { nextAttemptAt: retryAt } : {}),
			...(seen.mimeType ? { mimeType: seen.mimeType } : {})
		}
	);
	return state;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
