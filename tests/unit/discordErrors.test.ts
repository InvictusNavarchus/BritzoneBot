import { describe, expect, it } from 'vitest';
import {
	DiscordErrorCode,
	getDiscordErrorCode,
	isPermanentDiscordFailure,
	isUnknownChannelError,
} from '@/lib/discord/errors.js';

/** Builds an error shaped like a discord.js DiscordAPIError. */
function apiError(code: number, status?: number): Error {
	return Object.assign(new Error(`Discord API error ${code}`), {
		code,
		...(status === undefined ? {} : { status }),
	});
}

describe('discord error classification (errors.ts)', () => {
	describe('getDiscordErrorCode', () => {
		it('reads the numeric code off an API error', () => {
			expect(getDiscordErrorCode(apiError(10003))).toBe(10003);
		});

		it('returns undefined for errors without a numeric code', () => {
			expect(getDiscordErrorCode(new Error('socket hang up'))).toBeUndefined();
			expect(
				getDiscordErrorCode(
					Object.assign(new Error('dns'), { code: 'EAI_AGAIN' }),
				),
			).toBeUndefined();
			expect(getDiscordErrorCode(null)).toBeUndefined();
			expect(getDiscordErrorCode('not an error')).toBeUndefined();
		});
	});

	describe('isUnknownChannelError', () => {
		it('recognises a deleted channel by code or by HTTP 404', () => {
			expect(
				isUnknownChannelError(apiError(DiscordErrorCode.UnknownChannel, 404)),
			).toBe(true);
			expect(isUnknownChannelError(apiError(0, 404))).toBe(true);
		});

		it('does not mistake a permission failure for a deleted channel', () => {
			expect(
				isUnknownChannelError(
					apiError(DiscordErrorCode.MissingPermissions, 403),
				),
			).toBe(false);
			expect(
				isUnknownChannelError(apiError(DiscordErrorCode.MissingAccess, 403)),
			).toBe(false);
		});
	});

	describe('isPermanentDiscordFailure', () => {
		it('treats missing channels and missing permissions as permanent', () => {
			expect(
				isPermanentDiscordFailure(apiError(DiscordErrorCode.UnknownChannel)),
			).toBe(true);
			expect(
				isPermanentDiscordFailure(apiError(DiscordErrorCode.MissingAccess)),
			).toBe(true);
			expect(
				isPermanentDiscordFailure(
					apiError(DiscordErrorCode.MissingPermissions),
				),
			).toBe(true);
		});

		it('treats transient faults as retryable', () => {
			// Rate limits and network faults are exactly what backoff is for.
			expect(isPermanentDiscordFailure(apiError(0, 429))).toBe(false);
			expect(isPermanentDiscordFailure(apiError(0, 500))).toBe(false);
			expect(isPermanentDiscordFailure(new Error('socket hang up'))).toBe(
				false,
			);
		});
	});
});
