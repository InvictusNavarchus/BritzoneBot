import type { ChatInputCommandInteraction } from 'discord.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import {
	getCurrentOperation,
	getMainRoom,
	getRooms,
	getTimerData,
} from '@/modules/breakout/state/state.js';
import { formatBreakoutStatus } from '@/modules/breakout/utils/status.js';

/**
 * Handles the status subcommand for breakout rooms
 */
export async function handleStatusCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (!interaction.guildId || !interaction.guild) return;

	await handleInteraction(
		interaction,
		async (ctx) => {
			const guild = interaction.guild;
			if (!guild) return;
			const guildId = interaction.guildId;
			if (!guildId) return;

			const log = logger.child({
				subcommand: 'status',
				guildId,
			});

			log.info('📊 Checking breakout session status');

			const mainRoom = getMainRoom(guild);
			const breakoutRooms = getRooms(guild);
			const timerData = await getTimerData(guildId);
			const currentOp = await getCurrentOperation(guildId);

			const statusText = formatBreakoutStatus({
				mainRoom,
				breakoutRooms,
				timerData,
				currentOperationType: currentOp?.type,
			});

			await ctx.reply(statusText);
		},
		{ ephemeral: true },
	);
}
