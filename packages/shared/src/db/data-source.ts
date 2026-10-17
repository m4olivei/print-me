import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DataSource } from 'typeorm';
import { ACTIVE_JOB_INDEX, ACTIVE_JOB_STATES, PrintJob } from './entities/PrintJob.js';

/** How long a connection waits for another process's write lock (ms). */
const BUSY_TIMEOUT_MS = 5000;

const activeStatesSql = ACTIVE_JOB_STATES.map((state) => `'${state}'`).join(',');

/**
 * Create and initialise the shared SQLite data source.
 *
 * Both the web app and the worker call this with the same file path (`DB_PATH`)
 * so SQLite stays the single source of shared state.
 *
 * - Tables: `synchronize: true` (greenfield; switch to migrations once the
 *   schema has to evolve with data in place).
 * - WAL journal mode plus a busy timeout let the web app and worker write to
 *   the same file at the same time.
 * - The partial unique index is created with raw SQL after initialisation,
 *   because TypeORM `synchronize` has been unreliable with partial (`WHERE`)
 *   indexes. If `sqlite_master` doesn't list it afterwards, this throws: the
 *   dedupe backstop must never be silently absent.
 */
export async function initDatabase(dbPath: string): Promise<DataSource> {
	mkdirSync(dirname(dbPath), { recursive: true });
	const dataSource = new DataSource({
		type: 'better-sqlite3',
		database: dbPath,
		entities: [PrintJob],
		synchronize: true,
		enableWAL: true,
		timeout: BUSY_TIMEOUT_MS
	});
	await dataSource.initialize();
	try {
		await ensureActiveJobIndex(dataSource);
	} catch (err) {
		await dataSource.destroy();
		throw err;
	}
	return dataSource;
}

async function ensureActiveJobIndex(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		`CREATE UNIQUE INDEX IF NOT EXISTS ${ACTIVE_JOB_INDEX} ` +
			`ON print_job(driveFileId) WHERE state IN (${activeStatesSql})`
	);
	const rows: unknown[] = await dataSource.query(
		`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'print_job' AND name = ?`,
		[ACTIVE_JOB_INDEX]
	);
	if (rows.length !== 1) {
		throw new Error(
			`Refusing to start: unique index ${ACTIVE_JOB_INDEX} is missing from print_job`
		);
	}
}
