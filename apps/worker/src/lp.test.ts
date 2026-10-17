import { describe, expect, it, vi } from 'vitest';
import { submitToCups, type ExecFn } from './lp.js';

/** A stub `execFile` that records its call and answers with `stdout`. */
function stubExec(stdout: string) {
	return vi.fn<ExecFn>(async () => ({ stdout, stderr: '' }));
}

describe('submitToCups', () => {
	it('runs lp with an argument array and returns the CUPS job id from its output', async () => {
		// Real output captured from the Pi's CUPS during the printer spike.
		const exec = stubExec('request id is scx4623fw-3 (1 file(s))\n');

		const jobId = await submitToCups(
			{ printer: 'scx4623fw', filePath: '/tmp/print-me-job-x/document', options: ['-o', 'fit'] },
			exec
		);

		expect(jobId).toBe('scx4623fw-3');
		expect(exec).toHaveBeenCalledWith('lp', [
			'-d',
			'scx4623fw',
			'-o',
			'fit',
			'--',
			'/tmp/print-me-job-x/document'
		]);
	});

	it('throws with the raw output when lp prints no request id', async () => {
		const exec = stubExec('lp: something unexpected happened\n');

		await expect(
			submitToCups({ printer: 'scx4623fw', filePath: '/tmp/doc', options: [] }, exec)
		).rejects.toThrow(/Unexpected lp output: "lp: something unexpected happened\\n"/);
	});
});
