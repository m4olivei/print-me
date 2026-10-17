import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn
} from 'typeorm';

/**
 * Lifecycle of a print job:
 * - `queued`: waiting for the worker (possibly until `nextAttemptAt` after a failed attempt).
 * - `processing`: claimed by the worker.
 * - `printed`: accepted by CUPS.
 * - `failed`: gave up (permanent error or retries exhausted).
 */
export type JobState = 'queued' | 'processing' | 'printed' | 'failed';

/**
 * States in which a job is "active". At most one active job may exist per
 * `driveFileId`; the partial unique index created by `initDatabase` enforces it.
 */
export const ACTIVE_JOB_STATES = ['queued', 'processing'] as const satisfies readonly JobState[];

/** Name of the partial unique index that allows one active job per Drive file. */
export const ACTIVE_JOB_INDEX = 'idx_print_job_active_drive_file';

/**
 * One request to print a Drive file.
 *
 * Timestamps are `datetime` columns: TypeORM stores them as UTC
 * `YYYY-MM-DD HH:MM:SS.SSS` text, so comparing against `Date` parameters
 * (e.g. `MoreThan(date)`, `LessThanOrEqual(date)`) is correct in SQLite.
 *
 * The partial unique index on `driveFileId` is not declared here: `initDatabase`
 * creates it with raw SQL. The `synchronize: false` marker below only tells
 * TypeORM `synchronize` to leave that index alone; without it, every startup
 * drops the index as unknown before `initDatabase` re-creates it.
 */
@Entity('print_job')
@Index(ACTIVE_JOB_INDEX, { synchronize: false })
export class PrintJob {
	@PrimaryGeneratedColumn()
	id!: number;

	/** The Drive link as submitted. */
	@Column('text')
	url!: string;

	/** File ID extracted from `url`. */
	@Column('text')
	driveFileId!: string;

	@Column('text')
	state!: JobState;

	/** Attempts made so far (0 to `MAX_ATTEMPTS`). */
	@Column('integer', { default: 0 })
	attempts!: number;

	/** Earliest moment the worker may pick the job up. */
	@Column('datetime')
	nextAttemptAt!: Date;

	/** Short message from the last failed attempt. */
	@Column('text', { nullable: true })
	lastError!: string | null;

	/** mimeType resolved from Drive. */
	@Column('text', { nullable: true })
	mimeType!: string | null;

	/** Job id returned by `lp`. */
	@Column('text', { nullable: true })
	cupsJobId!: string | null;

	@CreateDateColumn()
	createdAt!: Date;

	@UpdateDateColumn()
	updatedAt!: Date;
}
