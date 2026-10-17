/**
 * Document-type handler registry, keyed by Drive mimeType.
 *
 * Only `application/pdf` is supported. To add a type, write a `DocumentHandler`
 * and add it to `HANDLERS` below.
 */
import { UnsupportedDocumentTypeError } from '../errors.js';
import type { DocumentHandler } from './handler.js';
import { pdfHandler } from './pdf.js';

export type { DocumentHandler, PreparedDocument } from './handler.js';
export { pdfHandler } from './pdf.js';

const HANDLERS: readonly DocumentHandler[] = [pdfHandler];

const registry = new Map<string, DocumentHandler>(HANDLERS.map((h) => [h.mimeType, h]));

/**
 * Returns the handler for `mimeType`.
 *
 * @throws {UnsupportedDocumentTypeError} if no handler is registered for it
 *   (a `PermanentJobError`, so the worker fails the job without retrying).
 */
export function getHandler(mimeType: string): DocumentHandler {
	const handler = registry.get(mimeType);
	if (!handler) {
		throw new UnsupportedDocumentTypeError(mimeType);
	}
	return handler;
}
