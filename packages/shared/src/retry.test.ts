import { describe, expect, it } from 'vitest';
import { computeRetry, MAX_ATTEMPTS } from './retry.js';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const MINUTE_MS = 60_000;

describe('computeRetry', () => {
	it('allows five attempts in total', () => {
		expect(MAX_ATTEMPTS).toBe(5);
	});

	it.each([
		[1, 1],
		[2, 2],
		[3, 4],
		[4, 8]
	])('after attempt %i retries %i minute(s) later', (attemptsUsed, minutes) => {
		expect(computeRetry(attemptsUsed, NOW)).toEqual({
			retryAt: new Date(NOW.getTime() + minutes * MINUTE_MS)
		});
	});

	it('gives up after the fifth attempt', () => {
		expect(computeRetry(5, NOW)).toEqual({ giveUp: true });
	});

	it('gives up if the attempt count has somehow gone past the limit', () => {
		expect(computeRetry(6, NOW)).toEqual({ giveUp: true });
	});

	it('does not mutate the supplied clock', () => {
		const now = new Date(NOW);
		computeRetry(1, now);
		expect(now).toEqual(NOW);
	});

	it.each([0, -1, 1.5, Number.NaN])('rejects an invalid attempt count (%s)', (attemptsUsed) => {
		expect(() => computeRetry(attemptsUsed, NOW)).toThrow(RangeError);
	});
});
