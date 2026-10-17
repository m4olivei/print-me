/**
 * apps/worker — the print queue worker.
 *
 * Every POLL_INTERVAL_MS (default 10000) it handles at most one due job (see
 * `./jobs.ts`): fetch the file from Drive, prepare it with the mimeType's
 * handler and submit it to CUPS with `lp`. Ticks are chained with
 * `setTimeout`, so they never overlap. A failing job never stops the loop.
 *
 * This is the only process that calls Google Drive and CUPS, and the only
 * worker: at startup it returns any job a crash left in `processing` to
 * `queued`. SIGTERM/SIGINT stop the loop after the current tick and close the
 * database; systemd (`print-me-worker.service`) handles restarts.
 */
import { createDriveClient, initDatabase } from '@print-me/shared';
import { loadConfig } from './config.js';
import { resetInterruptedJobs, runTick, type WorkerDeps } from './jobs.js';

function log(message: string): void {
	console.log(`${new Date().toISOString()} ${message}`);
}

async function main(): Promise<void> {
	const config = loadConfig();
	log(
		`worker starting: printer=${config.printerName} poll=${config.pollIntervalMs}ms ` +
			`maxFileBytes=${config.maxFileBytes}`
	);

	const dataSource = await initDatabase(config.dbPath);
	const reset = await resetInterruptedJobs(dataSource);
	if (reset > 0) log(`reset ${reset} interrupted job(s) to queued`);

	const deps: WorkerDeps = {
		dataSource,
		drive: createDriveClient(config.keyFile),
		printer: config.printerName,
		maxFileBytes: config.maxFileBytes,
		log
	};

	let stopping = false;
	let timer: NodeJS.Timeout | undefined;
	let inFlight: Promise<void> | undefined;

	const tick = async (): Promise<void> => {
		try {
			await runTick(deps);
		} catch (error) {
			// runTick records attempt errors on the job; this is a database failure.
			log(`tick failed: ${error}`);
		}
	};

	const schedule = (delayMs: number): void => {
		timer = setTimeout(() => {
			inFlight = tick().finally(() => {
				inFlight = undefined;
				if (!stopping) schedule(config.pollIntervalMs);
			});
		}, delayMs);
	};

	const shutdown = async (signal: string): Promise<void> => {
		if (stopping) return;
		stopping = true;
		log(`${signal} received: stopping after the current tick`);
		clearTimeout(timer);
		await inFlight;
		await dataSource.destroy();
		log('worker stopped');
		process.exit(0);
	};
	process.on('SIGTERM', () => void shutdown('SIGTERM'));
	process.on('SIGINT', () => void shutdown('SIGINT'));

	schedule(0);
}

main().catch((error) => {
	// Startup (env/db) failures are fatal; systemd's Restart=always retries.
	console.error(error);
	process.exit(1);
});
