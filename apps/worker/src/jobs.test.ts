import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	type DriveClient,
	type DriveFileMetadata,
	initDatabase,
	type JobState,
	PrintJob
} from '@print-me/shared';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetInterruptedJobs, runTick, type WorkerDeps } from './jobs.js';

let dir: string;
let dataSource: DataSource;

const T0 = new Date('2026-10-17T12:00:00.000Z');
const minutes = (n: number) => n * 60_000;
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

const PDF: DriveFileMetadata = { name: 'doc.pdf', mimeType: 'application/pdf', size: 1000 };

function fakeDrive(meta: DriveFileMetadata | Error) {
	const downloads: string[] = [];
	const drive: DriveClient = {
		getMetadata: vi.fn(async () => {
			if (meta instanceof Error) throw meta;
			return meta;
		}),
		downloadToFile: vi.fn(async (_fileId: string, destPath: string) => {
			downloads.push(destPath);
		})
	};
	return { drive, downloads };
}

function deps(drive: DriveClient, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
	return {
		dataSource,
		drive,
		printer: 'scx4623fw',
		maxFileBytes: 5000,
		submit: vi.fn(async () => 'scx4623fw-3'),
		now: () => T0,
		log: () => undefined,
		...overrides
	};
}

async function insertJob(fields: Partial<PrintJob> = {}): Promise<number> {
	const result = await dataSource.getRepository(PrintJob).insert({
		url: 'https://drive.google.com/file/d/FILE_ID/view',
		driveFileId: 'FILE_ID',
		state: 'queued',
		attempts: 0,
		nextAttemptAt: T0,
		...fields
	});
	return result.identifiers[0].id as number;
}

const load = (id: number) => dataSource.getRepository(PrintJob).findOneByOrFail({ id });

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), 'print-me-worker-test-'));
	dataSource = await initDatabase(join(dir, 'print-me.sqlite'));
});

afterEach(async () => {
	await dataSource.destroy();
	rmSync(dir, { recursive: true, force: true });
});

describe('runTick', () => {
	it('prints a due PDF: stores the CUPS job id and mimeType, and removes the temp file', async () => {
		const id = await insertJob();
		const { drive, downloads } = fakeDrive(PDF);
		const submit = vi.fn(async () => 'scx4623fw-3');

		expect(await runTick(deps(drive, { submit }))).toEqual({ id, state: 'printed' });

		const job = await load(id);
		expect(job).toMatchObject({
			state: 'printed',
			attempts: 1,
			cupsJobId: 'scx4623fw-3',
			mimeType: 'application/pdf',
			lastError: null
		});
		expect(downloads).toHaveLength(1);
		expect(submit).toHaveBeenCalledWith({
			printer: 'scx4623fw',
			filePath: downloads[0],
			options: []
		});
		expect(existsSync(downloads[0])).toBe(false);
	});

	it('handles one due job per tick, oldest first, and skips jobs not yet due', async () => {
		const notDue = await insertJob({ driveFileId: 'LATER', nextAttemptAt: at(minutes(1)) });
		const first = await insertJob({ driveFileId: 'A', createdAt: at(-minutes(2)) });
		const second = await insertJob({ driveFileId: 'B', createdAt: at(-minutes(1)) });
		const { drive } = fakeDrive(PDF);

		expect(await runTick(deps(drive))).toEqual({ id: first, state: 'printed' });
		expect((await load(second)).state).toBe('queued');
		expect(await runTick(deps(drive))).toEqual({ id: second, state: 'printed' });
		expect(await runTick(deps(drive))).toBeNull();
		expect((await load(notDue)).state).toBe('queued');
	});

	it.each<[string, DriveFileMetadata, RegExp]>([
		['over MAX_FILE_BYTES', { ...PDF, size: 5001 }, /5001 bytes.*5000/],
		['not a supported type', { ...PDF, mimeType: 'image/png' }, /Unsupported document type/]
	])('fails a file that is %s after one attempt without downloading it', async (_, meta, error) => {
		const id = await insertJob();
		const { drive, downloads } = fakeDrive(meta);

		expect(await runTick(deps(drive))).toEqual({ id, state: 'failed' });

		const job = await load(id);
		expect(job.attempts).toBe(1);
		expect(job.lastError).toMatch(error);
		expect(downloads).toHaveLength(0);
	});

	it('retries a failing job with backoff and fails it after the 5th attempt', async () => {
		const id = await insertJob();
		const { drive } = fakeDrive(new Error('x'.repeat(2000)));
		const expectedStates: JobState[] = ['queued', 'queued', 'queued', 'queued', 'failed'];
		let now = T0;

		for (const [i, expected] of expectedStates.entries()) {
			expect(await runTick(deps(drive, { now: () => now }))).toEqual({ id, state: expected });
			const job = await load(id);
			expect(job.attempts).toBe(i + 1);
			expect(job.lastError?.length).toBeLessThanOrEqual(500);
			if (expected === 'queued') {
				// 1, 2, 4, 8 minutes: not due a moment before, due exactly then.
				const backoff = minutes(2 ** i);
				expect(job.nextAttemptAt.getTime()).toBe(now.getTime() + backoff);
				expect(
					await runTick(deps(drive, { now: () => new Date(now.getTime() + backoff - 1) }))
				).toBeNull();
				now = job.nextAttemptAt;
			}
		}
		expect(await runTick(deps(drive, { now: () => at(minutes(60)) }))).toBeNull();
	});
});

describe('resetInterruptedJobs', () => {
	it('returns jobs left in processing to queued', async () => {
		const interrupted = await insertJob({ state: 'processing' });
		const printed = await insertJob({ driveFileId: 'DONE', state: 'printed' });

		expect(await resetInterruptedJobs(dataSource)).toBe(1);
		expect((await load(interrupted)).state).toBe('queued');
		expect((await load(printed)).state).toBe('printed');
	});
});
