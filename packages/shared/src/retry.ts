/**
 * Retry policy for print jobs: the single authority on how many attempts a job
 * gets and how long to wait between them. The worker applies it after every
 * failed (non-permanent) attempt.
 */

/** Total attempts a job gets (the first try plus four retries) before it is marked failed. */
export const MAX_ATTEMPTS = 5;

const MINUTE_MS = 60_000;

/** Either retry no earlier than `retryAt`, or stop retrying. */
export type RetryDecision = { retryAt: Date } | { giveUp: true };

/**
 * Decides what happens after a failed attempt.
 *
 * @param attemptsUsed the attempt count including the one that just failed (1-based).
 * @param now the current time; the backoff is measured from here.
 * @returns `{ retryAt }` with an exponential backoff of 1, 2, 4 then 8 minutes
 *   after attempts 1–4, or `{ giveUp: true }` once `MAX_ATTEMPTS` have been used.
 */
export function computeRetry(attemptsUsed: number, now: Date): RetryDecision {
	if (!Number.isInteger(attemptsUsed) || attemptsUsed < 1) {
		throw new RangeError(`attemptsUsed must be a positive integer, got ${attemptsUsed}`);
	}
	if (attemptsUsed >= MAX_ATTEMPTS) {
		return { giveUp: true };
	}
	const delayMs = 2 ** (attemptsUsed - 1) * MINUTE_MS;
	return { retryAt: new Date(now.getTime() + delayMs) };
}
