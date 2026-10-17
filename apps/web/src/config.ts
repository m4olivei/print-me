/**
 * Environment configuration for the web app (spec'd by `apps/web/.env.example`).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WebConfig {
	/** Path to the shared SQLite database file (same file the worker uses). */
	dbPath: string;
	/** Loopback port to listen on; the tunnel connector is the only client. */
	port: number;
	/** Most print jobs that may be created in any one-hour window. */
	maxJobsPerHour: number;
}

/** Default listen port: clear of screen-time's 3000; matches `web_port` in infra/cloudflare. */
const DEFAULT_PORT = 3100;
const DEFAULT_MAX_JOBS_PER_HOUR = 20;

/**
 * Loads `apps/web/.env` with Node's built-in `process.loadEnvFile`, resolved from
 * this module's location (src/ under tsx, dist/ when built; the package dir is
 * one up) so it works regardless of the working directory. Variables already
 * set in the environment (e.g. from systemd's `EnvironmentFile=`) win.
 */
export function loadEnvFile(): void {
	const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	try {
		process.loadEnvFile(path.join(packageDir, '.env'));
	} catch {
		// No .env file: fine when the environment comes from elsewhere.
		// readConfig below catches real gaps.
	}
}

/** Reads and validates the web app's configuration; throws on a missing or bad value. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
	const dbPath = env.DB_PATH;
	if (!dbPath) {
		throw new Error('Missing required environment variable DB_PATH (see apps/web/.env.example)');
	}
	return {
		dbPath,
		port: positiveInteger(env, 'PORT', DEFAULT_PORT, 65535),
		maxJobsPerHour: positiveInteger(env, 'MAX_JOBS_PER_HOUR', DEFAULT_MAX_JOBS_PER_HOUR)
	};
}

function positiveInteger(
	env: NodeJS.ProcessEnv,
	name: string,
	fallback: number,
	max = Number.MAX_SAFE_INTEGER
): number {
	const raw = env[name];
	if (raw === undefined || raw === '') return fallback;
	const value = Number(raw);
	if (!/^\d+$/.test(raw) || value < 1 || value > max) {
		throw new Error(`${name} must be an integer between 1 and ${max}, got "${raw}"`);
	}
	return value;
}
