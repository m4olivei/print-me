/**
 * The one place the worker talks to CUPS: submits a file with `lp`.
 *
 * `lp` runs through `execFile` with an argument array, never a shell, so
 * nothing in a printer name, option or path is ever interpreted. The `--`
 * before the path stops `lp` reading it as an option.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** The slice of promisified `execFile` the helper needs; tests pass a stub. */
export type ExecFn = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync: ExecFn = promisify(execFile);

export interface LpSubmission {
	/** CUPS queue name (`CUPS_PRINTER_NAME`). */
	printer: string;
	/** File to print. */
	filePath: string;
	/** Extra `lp` arguments from the document handler, e.g. `['-o', 'fit-to-page']`. */
	options: string[];
}

/**
 * Matches `request id is <queue>-<n>`. Not anchored at the end: CUPS appends
 * ` (1 file(s))`, e.g. `request id is scx4623fw-3 (1 file(s))`.
 */
const REQUEST_ID = /request id is (\S+-\d+)/;

/**
 * Submits `filePath` to the CUPS queue and returns the CUPS job id in its full
 * `<queue>-<n>` form (the form `lpstat` and `cancel` take).
 *
 * @throws if `lp` fails (non-zero exit; the error carries its stderr) or its
 *   output has no request id (the error carries the raw output).
 */
export async function submitToCups(
	{ printer, filePath, options }: LpSubmission,
	exec: ExecFn = execFileAsync
): Promise<string> {
	const { stdout } = await exec('lp', ['-d', printer, ...options, '--', filePath]);
	const match = REQUEST_ID.exec(stdout);
	if (!match) {
		throw new Error(`Unexpected lp output: ${JSON.stringify(stdout)}`);
	}
	return match[1];
}
