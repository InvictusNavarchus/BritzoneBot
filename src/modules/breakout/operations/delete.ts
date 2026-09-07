import {
	ChannelType,
	type CommandInteraction,
	type StageChannel,
	type VoiceChannel,
} from 'discord.js';
import { isUnknownChannelError } from '@/lib/discord/errors.js';
import { preflightBreakoutFor } from '@/lib/discord/permission.js';
import { logger } from '@/lib/logger.js';
import { moveUserToRoom } from '@/modules/breakout/services/distribution.js';
import { deleteRoom } from '@/modules/breakout/services/room.js';
import { cancelBreakoutTimer } from '@/modules/breakout/services/timer.js';
import {
	clearSession,
	completeOperation,
	getCompletedSteps,
	getCurrentOperation,
	getMainRoom,
	getRooms,
	getSessionCategoryId,
	startOperation,
	updateProgress,
} from '@/modules/breakout/state/state.js';
import { findRoomsByNamePattern } from '@/modules/breakout/utils/rooms.js';
import type { OperationResult } from '@/types/index.js';

/**
 * Executes the delete operation: deletes all breakout room channels and clears the session state.
 */
export async function executeDelete(
	interaction: CommandInteraction,
): Promise<OperationResult> {
	const guildId = interaction.guildId;
	if (!guildId || !interaction.guild) {
		return {
			success: false,
			message: 'This command can only be used in a guild.',
		};
	}

	const operationType = 'delete';
	const log = logger.child({
		operation: operationType,
		guildId,
	});

	// Check if we are resuming an interrupted operation
	const currentOp = await getCurrentOperation(guildId);
	const isResuming = currentOp?.type === operationType;

	let breakoutRooms: VoiceChannel[] = [];

	if (isResuming) {
		log.info('🔄 Resuming delete operation');
		const storedRoomIds = currentOp.params.roomIds as string[];
		if (storedRoomIds) {
			const fetched: VoiceChannel[] = [];
			for (const id of storedRoomIds) {
				try {
					const cached = interaction.guild.channels.cache.get(id);
					const ch = cached ?? (await interaction.guild.channels.fetch(id));
					if (ch && ch.type === ChannelType.GuildVoice) {
						fetched.push(ch as VoiceChannel);
					}
				} catch (err: unknown) {
					// A room somebody deleted by hand is simply gone: nothing left to
					// delete, so skip it. Reporting that as a permission problem
					// wedged the operation permanently — no admin could grant a
					// permission that would bring the channel back, so the delete
					// never completed and (before the lock exemptions) blocked every
					// other subcommand behind it. executeRecall already treats this
					// case as a warning and continues.
					if (isUnknownChannelError(err)) {
						log.warn(
							{ roomId: id },
							'⏭️ Breakout room no longer exists on Discord; skipping',
						);
						continue;
					}

					log.warn(
						{ roomId: id, err },
						'❌ Bot lacks View Channel / Manage Channels access to breakout room',
					);
					return {
						success: false,
						message: `⚠️ I don't have **View Channel** / **Manage Channels** access to breakout room channel (\`${id}\`). Please ask an admin to grant the bot **View Channel** and **Manage Channels** permissions in the category/channel.`,
					};
				}
			}
			breakoutRooms = fetched;
		}
	}

	if (!isResuming || breakoutRooms.length === 0) {
		// Get breakout rooms
		breakoutRooms = getRooms(interaction.guild);

		// If no stored rooms, identify them by name pattern as fallback, scoped to
		// the session's category so unrelated rooms are never picked up.
		if (!breakoutRooms || breakoutRooms.length === 0) {
			breakoutRooms = findRoomsByNamePattern(
				interaction.guild,
				getSessionCategoryId(interaction.guild),
			);
		}

		if (breakoutRooms.length === 0) {
			log.warn('⚠️ No breakout rooms found to delete.');
			return {
				success: false,
				message: 'No breakout rooms found to delete!',
			};
		}
	}

	const check = preflightBreakoutFor(interaction, {
		channels: breakoutRooms,
		requireManageChannels: true,
	});
	if (!check.ok) {
		log.warn({ reason: check.reason }, '❌ Preflight permission check failed');
		return {
			success: false,
			message: check.reason ?? 'Permission check failed.',
		};
	}

	if (!isResuming) {
		await startOperation(guildId, operationType, {
			roomIds: breakoutRooms.map((room) => room.id),
		});

		log.info(
			{ roomsCount: breakoutRooms.length },
			'🔍 Found breakout room(s) to delete',
		);
	}

	// Auto-recall members to main room if one is configured (runs on both initial run and resume)
	const mainRoom = getMainRoom(interaction.guild);
	let membersRecalled = 0;

	for (const room of breakoutRooms) {
		const guildRoom = interaction.guild.channels.cache.get(room.id) as
			| VoiceChannel
			| undefined;
		if (guildRoom?.members && guildRoom.members.size > 0) {
			for (const member of guildRoom.members.values()) {
				if (mainRoom) {
					try {
						await moveUserToRoom(
							member,
							mainRoom as VoiceChannel | StageChannel,
						);
						membersRecalled++;
					} catch (err) {
						log.warn(
							{ memberId: member.id, err },
							'Failed to move user to main room during delete',
						);
					}
				}
				// If no main room, Discord handles disconnect on channel delete
			}
		}
	}

	if (membersRecalled > 0) {
		log.info({ membersRecalled }, '♻️ Recalled members before deleting rooms');
	}

	const totalRooms = breakoutRooms.length;
	let deletedRooms = 0;

	try {
		// Process each room deletion with checkpoints
		for (const room of breakoutRooms) {
			if (!room) continue;

			log.debug(
				{ roomName: room.name, roomId: room.id },
				'📌 Deleting breakout room',
			);

			const steps = await getCompletedSteps(guildId);
			const roomDeletedKey = `room_deleted_${room.id}`;

			if (steps[roomDeletedKey]) {
				log.debug(
					{ roomName: room.name },
					'⏭️ Room was already deleted, skipping',
				);
				deletedRooms++;
				continue;
			}

			try {
				const guildRoom = interaction.guild.channels.cache.get(room.id) as
					| VoiceChannel
					| undefined;

				if (guildRoom) {
					await deleteRoom(guildRoom, 'Breakout room session deleted');
					log.debug({ roomName: room.name }, '🗑️ Deleted breakout room');
				} else {
					log.debug(
						{ roomName: room.name },
						'⏭️ Room no longer exists on Discord server',
					);
				}

				await updateProgress(guildId, roomDeletedKey);
				deletedRooms++;
			} catch (error) {
				log.error(
					{ err: error, roomName: room.name },
					'❌ Failed to delete breakout room',
				);
			}
		}

		if (deletedRooms === totalRooms) {
			// Clear active breakout timer if one exists
			await cancelBreakoutTimer(guildId);

			// Clear stored session data since rooms are deleted
			await updateProgress(guildId, 'clear_session');
			await clearSession(guildId);

			// Complete operation
			await completeOperation(guildId);

			log.info(
				{ deletedRooms, totalRooms },
				'🎉 Successfully deleted breakout room(s).',
			);

			return {
				success: true,
				message: `Successfully deleted ${deletedRooms}/${totalRooms} breakout room(s)!`,
			};
		}

		log.warn(
			{ deletedRooms, totalRooms },
			'⚠️ Failed to delete some or all breakout rooms',
		);

		return {
			success: false,
			message: `Failed to delete ${totalRooms - deletedRooms}/${totalRooms} breakout room(s). Deleted ${deletedRooms}/${totalRooms}. Please check bot permissions and try again.`,
		};
	} catch (error) {
		log.error({ err: error }, '❌ Error in DeleteOperation');
		return {
			success: false,
			message:
				'An error occurred while deleting breakout rooms. You can try running the command again to resume the process.',
		};
	}
}
