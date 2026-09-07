import { ChannelType, Collection, type Guild } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { findRoomsByNamePattern } from '@/modules/breakout/utils/rooms.js';

/** Builds a guild whose channel cache holds the given channel descriptors. */
function guildWithChannels(
	channels: Array<{
		id: string;
		name: string;
		parentId: string | null;
		type?: ChannelType;
	}>,
): Guild {
	return {
		channels: {
			cache: new Collection(
				channels.map((channel) => [
					channel.id,
					{ ...channel, type: channel.type ?? ChannelType.GuildVoice },
				]),
			),
		},
	} as unknown as Guild;
}

describe('findRoomsByNamePattern', () => {
	const guild = guildWithChannels([
		{ id: 'a1', name: 'breakout-room-1', parentId: 'cat-session' },
		{ id: 'a2', name: 'breakout-room-2', parentId: 'cat-session' },
		{ id: 'b1', name: 'breakout-room-1', parentId: 'cat-elsewhere' },
		{ id: 'c1', name: 'General', parentId: 'cat-session' },
		{
			id: 'd1',
			name: 'breakout-room-notes',
			parentId: 'cat-session',
			type: ChannelType.GuildText,
		},
	]);

	it('returns only rooms inside the given category', () => {
		const rooms = findRoomsByNamePattern(guild, 'cat-session');
		expect(rooms.map((r) => r.id)).toEqual(['a1', 'a2']);
	});

	it('does not adopt a same-named room from another category', () => {
		const rooms = findRoomsByNamePattern(guild, 'cat-session');
		expect(rooms.map((r) => r.id)).not.toContain('b1');
	});

	it('falls back to a guild-wide scan when no category is recorded', () => {
		// Sessions created before category tracking have no categoryId, so the
		// previous behaviour is preserved rather than returning nothing.
		const rooms = findRoomsByNamePattern(guild);
		expect(rooms.map((r) => r.id)).toEqual(['a1', 'a2', 'b1']);
	});

	it('ignores non-voice channels and channels outside the naming pattern', () => {
		const rooms = findRoomsByNamePattern(guild);
		expect(rooms.map((r) => r.id)).not.toContain('c1');
		expect(rooms.map((r) => r.id)).not.toContain('d1');
	});

	it('returns nothing when the category holds no breakout rooms', () => {
		expect(findRoomsByNamePattern(guild, 'cat-empty')).toEqual([]);
	});
});
