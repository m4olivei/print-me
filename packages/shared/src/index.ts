/**
 * @print-me/shared — logic shared by the web app and the worker.
 *
 * Drive link parsing and the Drive client live in `./drive`, the document-type
 * handler registry in `./handlers`, the retry policy in `./retry`, and the
 * permanent-error types the worker uses to skip retries in `./errors`.
 */
export * from './drive/index.js';
export * from './handlers/index.js';
export { PermanentJobError, UnsupportedDocumentTypeError } from './errors.js';
export { computeRetry, MAX_ATTEMPTS, type RetryDecision } from './retry.js';
