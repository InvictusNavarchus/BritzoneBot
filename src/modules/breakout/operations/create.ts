import {
	ChannelType,
	type CommandInteraction,
	type StageChannel,
	type VoiceChannel,
} from 'discord.js';
import { logger } from '@/lib/logger.js';
import { moveUserToRoom } from '@/modules/breakout/services/distribution.js';
import {
	createRoom,
	deleteRoom,
	hasExistingBreakoutRooms,
} from '@/modules/breakout/services/room.js';
import {
	clearSession,
	completeOperation,
	getCompletedSteps,
	getCurrentOperation,
	getMainRoom,
	startOperation,
	storeRoomIds,
	updateProgress,
} from '@/modules/breakout/state/state.js';
import type { OperationResult } from '@/types/index.js';

/**
 * Executes the create breakout rooms operation
 */
export async function executeCreate(
	interaction: CommandInteraction,
	numRooms: number,
): Promise<OperationResult> {
	const guildId = interaction.guildId;
	if (!guildId || !interaction.guild) {
		return {
			success: false,
			message: 'This command can only be used in a guild.',
		};
	}

	const operationType = 'create';

	// Check if we are resuming an interrupted operation
	const currentOp = await getCurrentOperation(guildId);
	const isResuming = currentOp?.type === operationType;

	// On resume the original room count wins. The recorded checkpoints are keyed
	// `create_room_1..N` against the plan already in flight, so honouring a
	// different number here produced a mixed result: rooms from the first plan
	// reused under step keys belonging to the second.
	const resumedNumRooms =
		isResuming && typeof currentOp.params.numRooms === 'number'
			? currentOp.params.numRooms
			: undefined;
	const targetRooms = resumedNumRooms ?? numRooms;
	const countOverridden =
		resumedNumRooms !== undefined && resumedNumRooms !== numRooms;

	const log = logger.child({
		operation: operationType,
		guildId,
		numRooms: targetRooms,
		requestedNumRooms: numRooms,
	});

	try {
		if (isResuming) {
			if (countOverridden) {
				log.warn(
					{ resumedNumRooms, requestedNumRooms: numRooms },
					'⚠️ Resuming create with the original room count, ignoring the requested one',
				);
			}
			log.info(`🔄 Resuming create operation`);
		} else {
			// Check for existing breakout rooms and auto-reconcile
			const existingRooms = await hasExistingBreakoutRooms(interaction.guild);

			if (existingRooms.exists) {
				const occupiedRooms = existingRooms.rooms.filter(
					(r) => r.members && r.members.size > 0,
				);

				if (occupiedRooms.length > 0) {
					const mainRoom = getMainRoom(interaction.guild);
					if (mainRoom) {
						for (const room of occupiedRooms) {
							for (const member of room.members.values()) {
								try {
									await moveUserToRoom(
										member,
										mainRoom as VoiceChannel | StageChannel,
									);
								} catch (err) {
									log.warn(
										{ memberId: member.id, err },
										'Failed to move user to main room during create cleanup',
									);
								}
							}
						}
					}
					// If no main room is stored, just delete the channels —
					// Discord will disconnect occupants from voice.
				}

				for (const room of existingRooms.rooms) {
					try {
						await deleteRoom(room);
					} catch (err) {
						log.warn(
							{ roomId: room.id, err },
							'Failed to delete existing room during cleanup',
						);
					}
				}
				await clearSession(guildId);
				log.info(
					{ cleaned: existingRooms.rooms.length },
					'♻️ Cleaned existing rooms before create',
				);
			}

			// Start new operation
			await startOperation(guildId, operationType, { numRooms: targetRooms });
		}

		const createdChannels: VoiceChannel[] = [];

		// Fetch completed steps once before the loop for efficiency
		const steps = await getCompletedSteps(guildId);

		// Create each breakout room with checkpointing
		for (let i = 1; i <= targetRooms; i++) {
			const roomName = `breakout-room-${i}`;
			const stepKey = `create_room_${i}`;

			// Check if this step was already completed in a previous attempt
			if (steps[stepKey]) {
				log.debug({ roomName }, `⏭️ Room was already created, skipping`);

				// Try to find the existing channel to add to our list
				// We can use the ID stored in the step if available
				const storedChannelId = steps[stepKey].channelId;
				let existingChannel: VoiceChannel | undefined;

				if (typeof storedChannelId === 'string') {
					const cached = interaction.guild.channels.cache.get(storedChannelId);
					if (cached?.type === ChannelType.GuildVoice) {
						existingChannel = cached as VoiceChannel;
					}
				}

				if (!existingChannel) {
					// Fallback to name search
					const found = interaction.guild.channels.cache.find(
						(c) => c.name === roomName && c.type === ChannelType.GuildVoice,
					);
					if (found && found.type === ChannelType.GuildVoice) {
						existingChannel = found as VoiceChannel;
					}
				}

				if (existingChannel) {
					createdChannels.push(existingChannel);
					continue;
				}
			}

			try {
				const createdChannel = await createRoom(interaction, roomName);
				createdChannels.push(createdChannel);
				// Room creation is not idempotent: losing this checkpoint means a
				// resume creates a duplicate channel, so it is written eagerly.
				await updateProgress(
					guildId,
					stepKey,
					{ channelId: createdChannel.id },
					{ immediate: true },
				);
			} catch (error) {
				log.error({ err: error, roomName }, `❌ Failed to create room`);
				throw error;
			}
		}

		// Store the created breakout rooms
		await updateProgress(guildId, 'store_rooms', {
			roomIds: createdChannels.map((c) => c.id),
		});
		await storeRoomIds(
			guildId,
			createdChannels.map((c) => c.id),
		);

		// Complete operation
		await completeOperation(guildId);

		const cmdChannel = interaction.channel;
		const hasParent = Boolean(
			cmdChannel && 'parent' in cmdChannel && cmdChannel.parent,
		);
		const resumeNote = countOverridden
			? `\n⚠️ Resumed the interrupted create operation, which was for ${targetRooms} room(s), so your request for ${numRooms} was not applied. Run \`/breakout create\` again now that it has finished.`
			: '';

		return {
			success: true,
			message: `Successfully created ${targetRooms} breakout voice channels${
				hasParent ? ' in the same category' : ''
			}!${resumeNote}`,
		};
	} catch (error) {
		// Log using the scoped logger to preserve context
		log.error({ err: error }, `❌ Error in CreateOperation`);
		return {
			success: false,
			message:
				'An error occurred while creating breakout rooms. You can try running the command again to resume the process.',
		};
	}
}
