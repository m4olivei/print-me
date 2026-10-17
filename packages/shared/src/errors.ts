/**
 * Job error types.
 *
 * The worker retries any failed attempt according to the retry policy, except
 * for errors that are instances of `PermanentJobError`: retrying those cannot
 * succeed, so the job goes straight to `failed`.
 */

/** Base class for failures that no amount of retrying will fix. */
export class PermanentJobError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'PermanentJobError';
	}
}

/** The Drive file's mimeType has no registered document handler. */
export class UnsupportedDocumentTypeError extends PermanentJobError {
	constructor(public readonly mimeType: string) {
		super(`Unsupported document type: ${mimeType || '(none)'}`);
		this.name = 'UnsupportedDocumentTypeError';
	}
}
