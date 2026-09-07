import type { ChatInputCommandInteraction, VoiceChannel } from 'discord.js';
import { preflightBreakoutFor } from '@/lib/discord/permission.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { sendMessageToChannel } from '@/modules/breakout/services/message.js';

/**
 * Handles the send-message subcommand for voice channels
 */
export async function handleSendMessageCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	await handleInteraction(
		interaction,
		async (ctx) => {
			const channel = interaction.options.getChannel(
				'channel',
				true,
			) as VoiceChannel;
			const message = interaction.options.getString('message', true);

			const check = preflightBreakoutFor(interaction, {
				textChannel: channel,
			});
			if (!check.ok) {
				await ctx.reply(check.reason ?? 'Permission check failed.');
				return;
			}

			const log = logger.child({
				subcommand: 'send-message',
				guildId: interaction.guildId,
				channel: channel.name,
			});

			log.info('📨 Sending message');

			const result = await sendMessageToChannel(channel, message);

			await ctx.reply({
				content: result.message,
			});
		},
		{ deferReply: true, ephemeral: true },
	);
}
