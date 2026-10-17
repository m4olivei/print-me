/**
 * The webhook's routes (see the "Data Contract: Webhook API" in plan 01).
 *
 * The app only reads and writes SQLite: it never calls Google Drive or CUPS.
 * Dedupe and the hourly cap live in the shared `intakeJob`, which runs its own
 * `BEGIN IMMEDIATE` transaction on the data source's single connection, so the
 * routes here must never open a transaction of their own; plain reads are fine.
 */
import { intakeJob, parseDriveFileId, PrintJob } from '@print-me/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { DataSource } from 'typeorm';

export interface AppOptions {
	/** Most print jobs that may be created in any one-hour window. */
	maxJobsPerHour: number;
	/** Fastify's logger option; defaults to pino logging to stdout. */
	logger?: FastifyServerOptions['logger'];
}

interface PrintBody {
	url: string;
}

interface JobParams {
	id: number;
}

const printBodySchema = {
	type: 'object',
	required: ['url'],
	properties: { url: { type: 'string', minLength: 1 } }
} as const;

const jobParamsSchema = {
	type: 'object',
	required: ['id'],
	properties: { id: { type: 'integer', minimum: 1 } }
} as const;

/** Builds the Fastify instance without listening, so callers decide how to serve it. */
export function buildApp(dataSource: DataSource, options: AppOptions): FastifyInstance {
	const app = Fastify({ logger: options.logger ?? true });
	const jobs = dataSource.getRepository(PrintJob);

	app.post<{ Body: PrintBody }>(
		'/print',
		{ schema: { body: printBodySchema } },
		async (request, reply) => {
			const { url } = request.body;
			const driveFileId = parseDriveFileId(url);
			if (driveFileId === null) {
				return reply.code(400).send({ error: 'Not a recognised Google Drive file link' });
			}

			const result = await intakeJob(dataSource, {
				url,
				driveFileId,
				maxJobsPerHour: options.maxJobsPerHour
			});
			switch (result.kind) {
				case 'created':
					request.log.info({ jobId: result.id, driveFileId }, 'print job queued');
					return reply.code(202).send({ id: result.id });
				case 'existing':
					request.log.info({ jobId: result.id, driveFileId }, 'print job already active');
					return reply.code(200).send({ id: result.id });
				case 'rate-limited':
					request.log.warn(
						{ retryAfterSeconds: result.retryAfterSeconds },
						'hourly print job cap reached'
					);
					return reply.code(429).header('Retry-After', String(result.retryAfterSeconds)).send({
						error: 'Hourly print job limit reached',
						retryAfterSeconds: result.retryAfterSeconds
					});
			}
		}
	);

	app.get<{ Params: JobParams }>(
		'/print/:id',
		{ schema: { params: jobParamsSchema } },
		async (request, reply) => {
			const job = await jobs.findOneBy({ id: request.params.id });
			if (job === null) {
				return reply.code(404).send({ error: 'Print job not found' });
			}
			return {
				id: job.id,
				state: job.state,
				attempts: job.attempts,
				lastError: job.lastError,
				cupsJobId: job.cupsJobId,
				createdAt: job.createdAt.toISOString(),
				updatedAt: job.updatedAt.toISOString()
			};
		}
	);

	app.get('/healthz', async () => {
		await dataSource.query('SELECT 1');
		return { ok: true };
	});

	return app;
}
