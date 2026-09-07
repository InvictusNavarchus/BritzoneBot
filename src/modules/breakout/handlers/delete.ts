import type { ChatInputCommandInteraction } from 'discord.js';
import { confirmAction } from '@/lib/discord/confirm.js';
import { preflightBreakoutFor } from '@/lib/discord/permission.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { executeDelete } from '@/modules/breakout/operations/delete.js';
import { getMainRoom, getRooms } from '@/modules/breakout/state/state.js';

/**
 * Handles the delete subcommand for breakout rooms
 */
export async function handleDeleteCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (!interaction.guildId || !interaction.guild) return;

	await handleInteraction(
		interaction,
		async (ctx) => {
			const category =
				interaction.channel && 'parent' in interaction.channel
					? interaction.channel.parent
					: undefined;
			const check = preflightBreakoutFor(interaction, {
				category: category ?? undefined,
				requireManageChannels: true,
			});
			if (!check.ok) {
				await ctx.reply(check.reason ?? 'Permission check failed.');
				return;
			}

			const log = logger.child({
				subcommand: 'delete',
				guildId: interaction.guildId,
			});

			log.info('🎯 Deleting breakout channels');

			const guild = interaction.guild;
			if (!guild) return;

			const breakoutRooms = getRooms(guild);
			const mainRoom = getMainRoom(guild);

			let totalMembers = 0;
			for (const room of breakoutRooms) {
				if (room.members && room.members.size > 0) {
					totalMembers += room.members.size;
				}
			}

			// Interactive confirmation if members exist and no main room is configured
			if (totalMembers > 0 && !mainRoom) {
				await confirmAction({
					interaction,
					content: `⚠️ ${totalMembers} member(s) are still in breakout rooms and no main room is configured. Deleting will disconnect them from voice.`,
					confirmLabel: `Delete and disconnect ${totalMembers} member(s)`,
					loadingContent: '⏳ Deleting breakout rooms...',
					onConfirm: async () => {
						const result = await executeDelete(interaction);
						if (result.success) {
							await ctx.editReply({
								content: result.message,
								components: [],
							});
							await ctx.sendPublic({
								content: `🗑️ ${result.message}`,
							});
						} else {
							await ctx.editReply({
								content: result.message || 'Failed to delete breakout rooms.',
								components: [],
							});
						}
					},
				});
				return;
			}

			const result = await executeDelete(interaction);

			if (result.success) {
				await ctx.reply(result.message);
				await ctx.sendPublic({
					content: `🗑️ ${result.message}`,
				});
			} else {
				await ctx.reply(result.message || 'Failed to delete breakout rooms.');
			}
		},
		{ deferReply: true, ephemeral: true, handlerTimeoutMs: 120_000 },
	);
}
