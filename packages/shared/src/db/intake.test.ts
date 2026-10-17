import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase } from './data-source.js';
import { ACTIVE_JOB_INDEX, type JobState, PrintJob } from './entities/PrintJob.js';
import { intakeJob, runIntake } from './intake.js';

let dir: string;
let dbPath: string;
let dataSource: DataSource;

const T0 = new Date('2026-10-17T12:00:00.000Z');
const minutes = (n: number) => n * 60_000;
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);
const urlFor = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

function intake(fileId: string, now: Date, maxJobsPerHour = 20) {
	return intakeJob(dataSource, { url: urlFor(fileId), driveFileId: fileId, maxJobsPerHour, now });
}

function setState(id: number, state: JobState) {
	return dataSource.getRepository(PrintJob).update({ id }, { state });
}

/** Inserts a job row with raw SQL, bypassing intake. */
function insertRaw(fileId: string, state: JobState) {
	return dataSource.query(
		`INSERT INTO print_job (url, driveFileId, state, nextAttemptAt) VALUES (?, ?, ?, datetime('now'))`,
		[urlFor(fileId), fileId, state]
	);
}

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'print-me-db-'));
	// A nested path proves init creates the parent directory.
	dbPath = join(dir, 'nested', 'print-me.sqlite');
	dataSource = await initDatabase(dbPath);
});

afterEach(async () => {
	await dataSource.destroy();
	rmSync(dir, { recursive: true, force: true });
});

describe('initDatabase', () => {
	it('creates the partial unique index on active jobs', async () => {
		const rows: { name: string; sql: string }[] = await dataSource.query(
			`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = ?`,
			[ACTIVE_JOB_INDEX]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].sql).toMatch(/WHERE state IN \('queued','processing'\)/);
	});

	it('keeps the index when an existing database is initialised again', async () => {
		// TypeORM synchronize drops indexes it doesn't know about unless told not to.
		await dataSource.destroy();
		dataSource = await initDatabase(dbPath);
		const rows: unknown[] = await dataSource.query(
			`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
			[ACTIVE_JOB_INDEX]
		);
		expect(rows).toHaveLength(1);
	});

	it('rejects a second active row for the same Drive file', async () => {
		await insertRaw('file-a', 'queued');
		await expect(insertRaw('file-a', 'processing')).rejects.toMatchObject({
			driverError: { code: 'SQLITE_CONSTRAINT_UNIQUE' }
		});
		// Inactive rows are outside the index.
		await insertRaw('file-a', 'printed');
		await insertRaw('file-a', 'failed');
	});
});

describe('intakeJob', () => {
	it('creates a queued job due now', async () => {
		const result = await intake('file-a', T0);
		expect(result.kind).toBe('created');
		const job = await dataSource
			.getRepository(PrintJob)
			.findOneByOrFail({ id: (result as { id: number }).id });
		expect(job).toMatchObject({
			url: urlFor('file-a'),
			driveFileId: 'file-a',
			state: 'queued',
			attempts: 0,
			nextAttemptAt: T0,
			createdAt: T0,
			lastError: null,
			mimeType: null,
			cupsJobId: null
		});
	});

	it('returns the existing job while it is queued or processing, and a new one after', async () => {
		const first = await intake('file-a', T0);
		if (first.kind !== 'created') throw new Error('expected created');

		expect(await intake('file-a', at(1000))).toEqual({ kind: 'existing', id: first.id });
		await setState(first.id, 'processing');
		expect(await intake('file-a', at(2000))).toEqual({ kind: 'existing', id: first.id });

		for (const finalState of ['printed', 'failed'] as const) {
			const current = await dataSource.getRepository(PrintJob).findOneByOrFail({
				driveFileId: 'file-a',
				state: 'processing'
			});
			await setState(current.id, finalState);
			const next = await intake('file-a', at(3000));
			expect(next.kind).toBe('created');
			expect((next as { id: number }).id).not.toBe(current.id);
			await setState((next as { id: number }).id, 'processing');
		}
	});

	it('enforces the hourly cap with the seconds until the oldest job ages out', async () => {
		expect((await intake('file-1', T0)).kind).toBe('created');
		expect((await intake('file-2', at(minutes(20)))).kind).toBe('created');
		expect((await intake('file-3', at(minutes(40)))).kind).toBe('created');

		// 3 jobs in the last hour; the oldest (T0) ages out at T0 + 60 min.
		const now = at(minutes(45) + 250);
		expect(await intake('file-4', now, 3)).toEqual({
			kind: 'rate-limited',
			retryAfterSeconds: 15 * 60 // 14 min 59.75 s, rounded up
		});

		// Once T0 is more than an hour old, the window holds 2 jobs again.
		expect((await intake('file-4', at(minutes(60) + 1), 3)).kind).toBe('created');
		// Now file-2 (T0 + 20 min) is the oldest in the window; 1 ms before it ages out -> 1 s.
		expect(await intake('file-5', at(minutes(80) - 1), 3)).toEqual({
			kind: 'rate-limited',
			retryAfterSeconds: 1
		});
	});

	it('answers a duplicate request even when the cap is reached, without counting it', async () => {
		const first = await intake('file-1', T0, 2);
		if (first.kind !== 'created') throw new Error('expected created');
		expect((await intake('file-2', at(1000), 2)).kind).toBe('created');

		expect(await intake('file-1', at(2000), 2)).toEqual({ kind: 'existing', id: first.id });
		expect(await intake('file-1', at(3000), 2)).toEqual({ kind: 'existing', id: first.id });
		expect(await dataSource.getRepository(PrintJob).count()).toBe(2);
		expect((await intake('file-3', at(4000), 2)).kind).toBe('rate-limited');
	});

	it('creates one job for concurrent requests for the same file', async () => {
		const results = await Promise.all([intake('file-a', T0), intake('file-a', T0)]);
		expect(results.map((r) => r.kind).sort()).toEqual(['created', 'existing']);
		expect((results[0] as { id: number }).id).toBe((results[1] as { id: number }).id);
	});

	it('recovers from a unique-constraint error by returning the active job', async () => {
		// Simulate losing the race: another writer's active job exists, and this
		// intake skips its dedupe lookup, so its insert hits the partial index.
		await insertRaw('file-a', 'processing');
		const [{ id: winnerId }]: { id: number }[] = await dataSource.query(
			`SELECT id FROM print_job WHERE driveFileId = 'file-a'`
		);

		const result = await runIntake(
			dataSource,
			{ url: urlFor('file-a'), driveFileId: 'file-a', maxJobsPerHour: 20, now: T0 },
			{ skipDedupeLookup: true }
		);

		expect(result).toEqual({ kind: 'existing', id: winnerId });
		expect(await dataSource.getRepository(PrintJob).count()).toBe(1);
	});
});
