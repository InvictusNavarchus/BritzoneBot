/**
 * Discord API error codes this bot reacts to by name rather than by number.
 *
 * @see https://discord.com/developers/docs/topics/opcodes-and-status-codes
 */
export const DiscordErrorCode = {
	/** The channel no longer exists (HTTP 404). */
	UnknownChannel: 10003,
	/** The bot cannot see the resource at all. */
	MissingAccess: 50001,
	/** The bot can see the resource but lacks the permission for this action. */
	MissingPermissions: 50013,
} as const;

/**
 * Extracts the numeric `code` from a Discord.js `DiscordAPIError`.
 *
 * @returns The API error code, or undefined for non-API errors such as network
 *   failures or timeouts.
 */
export function getDiscordErrorCode(error: unknown): number | undefined {
	if (!error || typeof error !== 'object' || !('code' in error)) {
		return undefined;
	}
	const code = (error as { code: unknown }).code;
	return typeof code === 'number' ? code : undefined;
}

/**
 * Extracts the HTTP status from a Discord.js `DiscordAPIError`.
 */
function getHttpStatus(error: unknown): number | undefined {
	if (!error || typeof error !== 'object' || !('status' in error)) {
		return undefined;
	}
	const status = (error as { status: unknown }).status;
	return typeof status === 'number' ? status : undefined;
}

/**
 * Returns whether an error means the channel is simply gone.
 *
 * Distinguishing this from a permission failure matters on resume paths: a
 * room an organiser deleted by hand should be skipped, whereas a genuine
 * permission problem should be surfaced to an admin who can fix it.
 */
export function isUnknownChannelError(error: unknown): boolean {
	return (
		getDiscordErrorCode(error) === DiscordErrorCode.UnknownChannel ||
		getHttpStatus(error) === 404
	);
}

/**
 * Returns whether an error will still fail however many times it is retried.
 *
 * A missing channel or a missing permission is a configuration fact, not a
 * transient fault; retrying with backoff only delays the inevitable while
 * blocking whatever else is queued behind it.
 */
export function isPermanentDiscordFailure(error: unknown): boolean {
	const code = getDiscordErrorCode(error);
	return (
		code === DiscordErrorCode.UnknownChannel ||
		code === DiscordErrorCode.MissingAccess ||
		code === DiscordErrorCode.MissingPermissions ||
		getHttpStatus(error) === 404
	);
}
