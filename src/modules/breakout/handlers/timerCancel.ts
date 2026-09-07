import type { ChatInputCommandInteraction } from 'discord.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { cancelBreakoutTimer } from '@/modules/breakout/services/timer.js';

/**
 * Handles the timer-cancel subcommand for breakout rooms
 */
export async function handleTimerCancelCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (!interaction.guildId || !interaction.guild) return;

	await handleInteraction(
		interaction,
		async (ctx) => {
			const guildId = interaction.guildId;
			if (!guildId) return;

			const log = logger.child({
				subcommand: 'timer-cancel',
				guildId,
			});

			log.info('⏱️ Canceling breakout timer');

			const canceled = await cancelBreakoutTimer(guildId);
			if (canceled) {
				await ctx.reply('⏱️ **Breakout timer canceled.**');
			} else {
				await ctx.reply('ℹ️ No active breakout timer to cancel.');
			}
		},
		{ ephemeral: true },
	);
}
