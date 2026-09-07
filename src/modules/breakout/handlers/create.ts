import type { ChatInputCommandInteraction } from 'discord.js';
import { confirmAction } from '@/lib/discord/confirm.js';
import { preflightBreakoutFor } from '@/lib/discord/permission.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { executeCreate } from '@/modules/breakout/operations/create.js';
import { hasExistingBreakoutRooms } from '@/modules/breakout/services/room.js';
import { getMainRoom } from '@/modules/breakout/state/state.js';

/**
 * Handles the create subcommand for breakout rooms
 */
export async function handleCreateCommand(
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

			const numRooms = interaction.options.getInteger('number', true);
			const log = logger.child({
				subcommand: 'create',
				guildId: interaction.guildId,
				numRooms,
			});

			log.info('🔢 Creating breakout rooms');

			const guild = interaction.guild;
			if (!guild) return;

			const existing = await hasExistingBreakoutRooms(guild);
			const mainRoom = getMainRoom(guild);

			let totalMembers = 0;
			if (existing.exists) {
				for (const room of existing.rooms) {
					if (room.members && room.members.size > 0) {
						totalMembers += room.members.size;
					}
				}
			}

			// Interactive confirmation if existing rooms have members and no main room is configured
			if (totalMembers > 0 && !mainRoom) {
				await confirmAction({
					interaction,
					content: `⚠️ ${totalMembers} member(s) are still in existing breakout rooms and no main room is configured. Creating new rooms will disconnect them from voice.`,
					confirmLabel: `Recreate rooms and disconnect ${totalMembers} member(s)`,
					loadingContent: '⏳ Creating breakout rooms...',
					onConfirm: async () => {
						const result = await executeCreate(interaction, numRooms);
						if (result.success) {
							await ctx.editReply({
								content: result.message,
								components: [],
							});
							await ctx.sendPublic({
								content: `🛠️ ${result.message}`,
							});
						} else {
							await ctx.editReply({
								content: result.message || 'Failed to create breakout rooms.',
								components: [],
							});
						}
					},
				});
				return;
			}

			const result = await executeCreate(interaction, numRooms);

			if (result.success) {
				await ctx.reply(result.message);
				await ctx.sendPublic({
					content: `🛠️ ${result.message}`,
				});
			} else {
				log.error({ result }, '❌ Error creating breakout rooms');
				await ctx.reply(result.message);
			}
		},
		{ deferReply: true, ephemeral: true, handlerTimeoutMs: 120_000 },
	);
}
