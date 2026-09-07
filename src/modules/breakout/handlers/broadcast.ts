import { type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { broadcastToBreakoutRooms } from '@/modules/breakout/services/message.js';

/**
 * Handles the broadcast subcommand for breakout rooms
 */
export async function handleBroadcastCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (!interaction.guildId || !interaction.guild) return;

	await handleInteraction(
		interaction,
		async (ctx) => {
			const { guild } = interaction;
			if (!guild) return;
			const message = interaction.options.getString('message', true);
			const log = logger.child({
				subcommand: 'broadcast',
				guildId: interaction.guildId,
			});

			log.info({ message }, '📢 Broadcasting message');

			const result = await broadcastToBreakoutRooms(guild, message);

			if (result.success) {
				const embed = new EmbedBuilder()
					.setTitle('Broadcast Results')
					.setColor('#00FF00')
					.setDescription('Message broadcast complete')
					.addFields({
						name: 'Successfully Sent To',
						value: result.sent.join('\n') || 'None',
						inline: true,
					});

				if (result.failed.length > 0) {
					embed.addFields({
						name: 'Failed To Send To',
						value: result.failed.join('\n'),
						inline: true,
					});
				}

				await ctx.reply({ embeds: [embed] });
			} else {
				await ctx.reply(result.message);
			}
		},
		{ deferReply: true, ephemeral: true },
	);
}
