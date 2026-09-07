import type { CommandInteraction, Guild, VoiceChannel } from 'discord.js';
import { createChannel } from '@/lib/discord/channel.js';
import { logger } from '@/lib/logger.js';
import {
	clearSession,
	getRooms,
	getSessionCategoryId,
	storeRoomIds,
} from '@/modules/breakout/state/state.js';
import { findRoomsByNamePattern } from '@/modules/breakout/utils/rooms.js';

interface ExistingRoomsResult {
	exists: boolean;
	rooms: VoiceChannel[];
	source?: 'stored' | 'pattern';
}

/**
 * Checks if breakout rooms already exist for the guild
 */
export async function hasExistingBreakoutRooms(
	guild: Guild,
): Promise<ExistingRoomsResult> {
	// Check in room manager first
	const storedRooms = getRooms(guild);
	if (storedRooms && storedRooms.length > 0) {
		// Verify rooms still exist in guild
		const existingRooms = storedRooms.filter((room) =>
			guild.channels.cache.has(room.id),
		);

		// Sync session manager if we found stale rooms
		if (existingRooms.length !== storedRooms.length) {
			if (existingRooms.length > 0) {
				await storeRoomIds(
					guild.id,
					existingRooms.map((r) => r.id),
				);
			} else {
				await clearSession(guild.id);
			}
		}

		if (existingRooms.length > 0) {
			return {
				exists: true,
				rooms: existingRooms,
				source: 'stored',
			};
		}
	}

	// Fallback: check for rooms by naming pattern, confined to the session's
	// category so rooms belonging to another category are never adopted.
	const patternRooms = findRoomsByNamePattern(
		guild,
		getSessionCategoryId(guild),
	);

	if (patternRooms.length > 0) {
		return {
			exists: true,
			rooms: patternRooms,
			source: 'pattern',
		};
	}

	return { exists: false, rooms: [] };
}

/**
 * Creates a single breakout room
 */
export async function createRoom(
	interaction: CommandInteraction,
	roomName: string,
): Promise<VoiceChannel> {
	const channel = interaction.channel;
	// Get parent category from channel if available, otherwise use guild as fallback
	// Use type guard to safely access parent property
	const channelParent = channel && 'parent' in channel ? channel.parent : null;
	// Ensure parent is only Guild or CategoryChannel (required by createChannel)
	const parent =
		channelParent && 'children' in channelParent
			? channelParent
			: interaction.guild;

	if (!parent) {
		throw new Error('Could not find a valid parent for the channel');
	}

	return await createChannel(parent, roomName);
}

/**
 * Deletes a single breakout room
 */
export async function deleteRoom(
	room: VoiceChannel,
	reason: string = 'Breakout room cleanup',
): Promise<void> {
	try {
		await room.delete(reason);
	} catch (error: unknown) {
		const isDiscordError =
			error && typeof error === 'object' && 'code' in error;
		const code = isDiscordError ? (error as { code: number }).code : null;
		const status =
			error && typeof error === 'object' && 'status' in error
				? (error as { status: number }).status
				: null;

		// If channel is already deleted on Discord (Code 10003: Unknown Channel, HTTP 404)
		if (code === 10003 || status === 404) {
			logger.warn(
				{ room: room.name, code, status },
				'⚠️ Room is already deleted on Discord',
			);
			return;
		}

		logger.error({ err: error, room: room.name }, `Failed to delete room`);
		throw error;
	}
}
