import type {
	ChatInputCommandInteraction,
	VoiceBasedChannel,
} from 'discord.js';
import { preflightBreakoutFor } from '@/lib/discord/permission.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { executeRecall } from '@/modules/breakout/operations/recall.js';
import { getMainRoom } from '@/modules/breakout/state/state.js';

/**
 * Handles the recall subcommand for breakout rooms
 */
export async function handleRecallCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (!interaction.guildId || !interaction.guild) return;

	await handleInteraction(
		interaction,
		async (ctx) => {
			const guild = interaction.guild;
			if (!guild) return;

			let mainChannel = interaction.options.getChannel(
				'mainroom',
			) as VoiceBasedChannel | null;

			if (!mainChannel) {
				const storedMainChannel = getMainRoom(guild);
				if (storedMainChannel) {
					mainChannel = storedMainChannel;
				} else {
					await ctx.reply(
						'Please specify a main voice channel where users should be moved back.',
					);
					return;
				}
			}

			const targetMainChannel = mainChannel;

			const check = preflightBreakoutFor(interaction, {
				voiceChannel: targetMainChannel,
				requireUserMove: true,
			});
			if (!check.ok) {
				await ctx.reply(check.reason ?? 'Permission check failed.');
				return;
			}

			const log = logger.child({
				subcommand: 'recall',
				guildId: interaction.guildId,
				mainRoom: targetMainChannel.name,
			});

			log.info('🎯 Recalling members from breakout session');

			const result = await executeRecall(interaction, targetMainChannel);

			if (result.success) {
				await ctx.reply(result.message);
				await ctx.sendPublic({
					content: `📢 ${result.message}`,
				});
			} else {
				await ctx.reply(result.message || 'Failed to recall breakout members.');
			}
		},
		{ deferReply: true, ephemeral: true, handlerTimeoutMs: 120_000 },
	);
}
