/**
 * apps/web: the print webhook (Fastify).
 *
 * Accepts `POST /print` and reports job status; the worker does the printing.
 * It listens on loopback only: the Cloudflare Tunnel connector on the same host
 * is its sole client, and Cloudflare Access enforces authentication at the
 * edge, so a LAN-facing port would be an unauthenticated way around it.
 */
import 'reflect-metadata';
import { initDatabase } from '@print-me/shared';
import { buildApp } from './app.js';
import { loadEnvFile, readConfig } from './config.js';

/** Fixed, not configurable: see the module comment. */
const HOST = '127.0.0.1';

async function main(): Promise<void> {
	loadEnvFile();
	const config = readConfig();
	const dataSource = await initDatabase(config.dbPath);
	const app = buildApp(dataSource, { maxJobsPerHour: config.maxJobsPerHour });

	let closing = false;
	const shutdown = (signal: NodeJS.Signals): void => {
		if (closing) return;
		closing = true;
		app.log.info({ signal }, 'shutting down');
		app
			.close()
			.then(() => dataSource.destroy())
			.then(
				() => process.exit(0),
				(err: unknown) => {
					app.log.error({ err }, 'error during shutdown');
					process.exit(1);
				}
			);
	};
	process.once('SIGTERM', shutdown);
	process.once('SIGINT', shutdown);

	await app.listen({ host: HOST, port: config.port });
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
