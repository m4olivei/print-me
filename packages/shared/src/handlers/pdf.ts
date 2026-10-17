import type { DocumentHandler } from './handler.js';

/** PDFs print as-is: CUPS filters them natively, so the file is passed through untouched. */
export const pdfHandler: DocumentHandler = {
	mimeType: 'application/pdf',
	async prepare(filePath) {
		return { filePath, lpOptions: [] };
	}
};
