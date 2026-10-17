/**
 * Worker configuration from the environment (see `apps/worker/.env.example`).
 *
 * `.env` is loaded from the package directory (apps/worker), resolved from
 * this module's location so it works regardless of cwd. Under systemd the
 * same file is passed via `EnvironmentFile=`; variables already set win.
 *
 * `PRINTER_DEVICE_URI` also lives in `.env` but is not read here: only the
 * `lpadmin` queue setup step uses it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WorkerConfig {
	dbPath: string;
	/** Path of the Drive service account's JSON key. */
	keyFile: string;
	printerName: string;
	pollIntervalMs: number;
	maxFileBytes: number;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** This file is src/config.ts (tsx) or dist/config.js (built): the package dir is one up. */
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(): WorkerConfig {
	try {
		process.loadEnvFile(path.join(packageDir, '.env'));
	} catch {
		// No .env file: fine when the environment comes from elsewhere
		// (e.g. systemd's EnvironmentFile=). requireEnv below catches real gaps.
	}
	const env = process.env;
	return {
		dbPath: requireEnv(env, 'DB_PATH'),
		keyFile: requireEnv(env, 'GOOGLE_APPLICATION_CREDENTIALS'),
		printerName: requireEnv(env, 'CUPS_PRINTER_NAME'),
		pollIntervalMs: positiveInt(env, 'POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
		maxFileBytes: positiveInt(env, 'MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES)
	};
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (value === undefined || value === '') {
		throw new Error(`Missing required environment variable ${name} (see apps/worker/.env.example)`);
	}
	return value;
}

/** Unset or empty means `fallback`; anything but a positive integer is a startup error. */
function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw === '') return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer, got "${raw}"`);
	}
	return value;
}
