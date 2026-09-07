import { ChannelType, type Guild, type VoiceChannel } from 'discord.js';

/** Prefix every breakout room name is created with. */
export const BREAKOUT_ROOM_NAME_PREFIX = 'breakout-room-';

/**
 * Finds breakout rooms by name pattern, scoped to a category when one is known.
 *
 * This is the fallback used when the session's stored room IDs are missing or
 * stale. Rooms are created inside the invoking channel's category with globally
 * unique-looking but guild-wide colliding names, so an unscoped scan would
 * happily adopt a leftover `breakout-room-1` sitting in an unrelated category —
 * and then recall members out of it, or delete it. Passing the session's
 * category confines the guess to where this session's rooms actually live.
 *
 * @param guild The guild to search.
 * @param categoryId Restrict results to this category. When null, only
 *   root-level channels (no category) are matched. When undefined (a legacy
 *   session recorded before category tracking), the scan falls back to the
 *   whole guild.
 */
export function findRoomsByNamePattern(
	guild: Guild,
	categoryId?: string | null,
): VoiceChannel[] {
	return Array.from(
		guild.channels.cache
			.filter(
				(channel): channel is VoiceChannel =>
					channel.type === ChannelType.GuildVoice &&
					channel.name.startsWith(BREAKOUT_ROOM_NAME_PREFIX) &&
					(categoryId === undefined
						? true
						: categoryId === null
							? channel.parentId === null
							: channel.parentId === categoryId),
			)
			.values(),
	);
}
