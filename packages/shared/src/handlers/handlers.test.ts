import { describe, expect, it } from 'vitest';
import { PermanentJobError, UnsupportedDocumentTypeError } from '../errors.js';
import { getHandler } from './index.js';

describe('document handler registry', () => {
	it('passes PDFs through to the printer unchanged with no lp options', async () => {
		const handler = getHandler('application/pdf');
		expect(handler.mimeType).toBe('application/pdf');
		await expect(handler.prepare('/tmp/print-me-x/doc.pdf')).resolves.toEqual({
			filePath: '/tmp/print-me-x/doc.pdf',
			lpOptions: []
		});
	});

	it.each(['application/vnd.google-apps.document', 'image/png', ''])(
		'treats %j as an unsupported document type, which is a permanent error',
		(mimeType) => {
			let thrown: unknown;
			try {
				getHandler(mimeType);
			} catch (err) {
				thrown = err;
			}
			expect(thrown).toBeInstanceOf(UnsupportedDocumentTypeError);
			expect(thrown).toBeInstanceOf(PermanentJobError);
			expect(thrown).toMatchObject({ name: 'UnsupportedDocumentTypeError', mimeType });
		}
	);

	it('does not treat ordinary errors as permanent', () => {
		expect(new Error('Drive 404')).not.toBeInstanceOf(PermanentJobError);
	});
});
