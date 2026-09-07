import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
	ComponentType,
	type GuildMember,
	type StageChannel,
	type VoiceChannel,
} from 'discord.js';
import { trackInteractivePrompt } from '@/lib/discord/components.js';
import { preflightBreakoutFor } from '@/lib/discord/permission.js';
import { handleInteraction, replyOrEdit } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { executeDistribute } from '@/modules/breakout/operations/distribute.js';
import { getRooms } from '@/modules/breakout/state/state.js';
import { distributeUsers } from '@/modules/breakout/utils/distribution.js';
import { buildDistributionEmbed } from '@/modules/breakout/utils/embeds.js';
import {
	parseMentions,
	resolveMentionedUserIds,
} from '@/modules/breakout/utils/mentions.js';
import type { OperationResult } from '@/types/index.js';

/** Shown in place of a prompt that a restart left unusable. */
const SHUTDOWN_PROMPT_NOTE =
	'⚠️ The bot restarted while this prompt was open, so it can no longer be used. Run the command again — `/breakout status` will show the current state first.';

/**
 * Partitions target voice channel members into facilitator and regular participant lists.
 */
function partitionMembers(
	members: Iterable<GuildMember>,
	excludedUsers: Set<string>,
	facilitatorIds: Set<string>,
): { facilitatorMembers: GuildMember[]; regularMembers: GuildMember[] } {
	const facilitatorMembers: GuildMember[] = [];
	const regularMembers: GuildMember[] = [];

	for (const member of members) {
		if (excludedUsers.has(member.user.id)) continue;
		if (facilitatorIds.has(member.user.id)) {
			facilitatorMembers.push(member);
		} else {
			regularMembers.push(member);
		}
	}

	return { facilitatorMembers, regularMembers };
}

/**
 * Handles the interactive preview and execution flow for distribution.
 */
async function runDistributionCollector(params: {
	interaction: ChatInputCommandInteraction;
	ctx: import('@/lib/discord/response.js').InteractionContext<ChatInputCommandInteraction>;
	mainRoom: VoiceChannel | StageChannel;
	breakoutRooms: VoiceChannel[];
	facilitators: Set<string>;
	excludedUsers: Set<string>;
	distribution: Record<string, GuildMember[]>;
	previewEmbed: import('discord.js').EmbedBuilder;
	confirmButton: ButtonBuilder;
	cancelButton: ButtonBuilder;
	mentionWarning?: string;
	log: typeof logger;
}): Promise<void> {
	const {
		interaction,
		ctx,
		mainRoom,
		breakoutRooms,
		facilitators,
		excludedUsers,
		distribution,
		previewEmbed,
		confirmButton,
		cancelButton,
		mentionWarning,
		log,
	} = params;

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		confirmButton,
		cancelButton,
	);

	log.info('📤 Sending preview with confirmation buttons');
	const response = await ctx.reply({
		...(mentionWarning ? { content: mentionWarning } : {}),
		embeds: [previewEmbed],
		components: [row],
	});

	const collector = response.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: 60_000,
	});

	const untrack = trackInteractivePrompt(async () => {
		collector.stop('shutdown');
		await ctx.editReply({
			content: SHUTDOWN_PROMPT_NOTE,
			embeds: [previewEmbed],
			components: [],
		});
	});

	return new Promise<void>((resolve) => {
		collector.on('collect', async (i) => {
			try {
				if (i.user.id !== interaction.user.id) {
					await replyOrEdit(i, {
						content:
							'You are not authorized to interact with this distribution preview.',
						ephemeral: true,
					});
					return;
				}

				if (i.customId === 'cancel_distribute') {
					collector.stop('cancelled');
					log.info('❌ Distribution cancelled by user');
					await i.update({
						content: '❌ Distribution cancelled.',
						embeds: [previewEmbed],
						components: [],
					});
					resolve();
					return;
				}

				if (i.customId === 'confirm_distribute') {
					collector.stop('confirmed');
					log.info('✅ Distribution confirmed by user');

					// The wait for a click is over; give the move loop the full
					// budget rather than whatever the user left of it.
					ctx.restartTimeout();

					const totalMembersToMove = Object.values(distribution).reduce(
						(sum, users) => sum + users.length,
						0,
					);

					await i.update({
						content: `⏳ Distributing users to breakout rooms... (0/${totalMembersToMove} member${totalMembersToMove === 1 ? '' : 's'} moved)`,
						embeds: [previewEmbed],
						components: [],
					});

					let progressState = {
						completed: 0,
						total: totalMembersToMove,
					};
					let lastReportedCompleted = 0;

					const progressInterval = setInterval(async () => {
						if (
							progressState.total > 0 &&
							progressState.completed !== lastReportedCompleted
						) {
							lastReportedCompleted = progressState.completed;
							try {
								await ctx.editReply({
									content: `⏳ Distributing users to breakout rooms... (${progressState.completed}/${progressState.total} member${progressState.total === 1 ? '' : 's'} moved)`,
									embeds: [previewEmbed],
									components: [],
								});
							} catch (err) {
								log.debug(
									{ err },
									'Failed to edit distribution progress reply',
								);
							}
						}
					}, 1000);

					let result: OperationResult;
					try {
						result = await executeDistribute(
							interaction,
							mainRoom,
							distribution,
							facilitators,
							(completed, total) => {
								progressState = { completed, total };
							},
						);
					} finally {
						clearInterval(progressInterval);
					}

					if (!result.success) {
						await ctx.editReply({
							content: `❌ ${result.message}`,
							embeds: [],
							components: [],
						});
						resolve();
						return;
					}

					log.debug('📝 Creating final response embed');
					const finalEmbed = buildDistributionEmbed({
						mainRoom,
						breakoutRooms,
						facilitators,
						excludedUsers,
						usersInMainRoom: mainRoom.members,
						moveResults: result.moveResults,
						distribution,
					});

					log.info('📤 Distribution completed successfully');
					await ctx.editReply({
						content: null as unknown as string,
						embeds: [finalEmbed],
						components: [],
					});
					await ctx.sendPublic({
						embeds: [finalEmbed],
					});
					resolve();
				}
			} catch (err) {
				log.error({ err }, 'Failed handling distribute component collector');
				resolve();
			}
		});

		collector.on('end', async (_, reason) => {
			untrack();

			if (reason === 'shutdown') {
				log.warn('🛑 Distribution preview closed by shutdown');
				resolve();
				return;
			}

			// For 'confirmed', executeDistribute is actively running in the
			// collect handler and will resolve this promise upon completion.
			if (reason === 'confirmed') {
				return;
			}

			if (reason !== 'cancelled') {
				log.warn('⏱️ Distribution preview confirmation timed out');
				const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
					confirmButton.setDisabled(true),
					cancelButton.setDisabled(true),
				);
				try {
					await ctx.editReply({
						content: '⏱️ Distribution request timed out.',
						embeds: [previewEmbed],
						components: [disabledRow],
					});
				} catch (err) {
					log.error({ err }, 'Failed to edit reply on collector timeout');
				}
			}
			resolve();
		});
	});
}

/**
 * Handles the distribute subcommand for breakout rooms
 */
export async function handleDistributeCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (!interaction.guildId || !interaction.guild) return;

	await handleInteraction(
		interaction,
		async (ctx) => {
			const mainRoom = interaction.options.getChannel('mainroom', true) as
				| VoiceChannel
				| StageChannel;

			if (!mainRoom?.isVoiceBased()) {
				await ctx.reply('Selected main room must be a voice or stage channel.');
				return;
			}

			const check = preflightBreakoutFor(interaction, {
				voiceChannel: mainRoom,
				category: mainRoom.parent ?? undefined,
				requireUserMove: true,
			});
			if (!check.ok) {
				await ctx.reply(check.reason ?? 'Permission check failed.');
				return;
			}

			const log = logger.child({
				subcommand: 'distribute',
				guildId: interaction.guildId,
				mainRoom: mainRoom.name,
			});
			log.info('🎯 Main room selected');

			const parsedExclude = parseMentions(
				interaction.options.getString('exclude'),
			);
			const parsedFacilitators = parseMentions(
				interaction.options.getString('facilitators'),
			);

			const guild = interaction.guild;
			if (!guild) return;

			const breakoutRooms = getRooms(guild);
			if (breakoutRooms.length === 0) {
				log.warn('❌ Error: No breakout rooms found');
				await ctx.reply(
					'No breakout rooms found! Please create breakout rooms first with `/breakout create`.',
				);
				return;
			}

			// Gather all members from main room and existing breakout rooms
			const allTargetMembers = new Map<string, GuildMember>();
			for (const [id, member] of mainRoom.members) {
				allTargetMembers.set(id, member);
			}
			for (const room of breakoutRooms) {
				if (room.members && room.members.size > 0) {
					for (const [id, member] of room.members) {
						allTargetMembers.set(id, member);
					}
				}
			}

			if (allTargetMembers.size === 0) {
				log.warn(`⚠️ No users found in ${mainRoom.name} or breakout rooms`);
				await ctx.reply(
					`There are no users in ${mainRoom.name} or breakout rooms to distribute.`,
				);
				return;
			}

			// Role mentions are expanded against the pool of members actually in
			// voice, so a role resolves to the people who can be distributed.
			const excludedUsers = resolveMentionedUserIds(
				parsedExclude,
				allTargetMembers.values(),
			);
			const rawFacilitators = resolveMentionedUserIds(
				parsedFacilitators,
				allTargetMembers.values(),
			);

			// Facilitators: Exclude takes precedence
			const facilitators = new Set<string>();
			for (const facId of rawFacilitators) {
				if (!excludedUsers.has(facId)) {
					facilitators.add(facId);
				}
			}

			const unrecognized = [
				...parsedExclude.unrecognized,
				...parsedFacilitators.unrecognized,
			];
			const MAX_REPORTED_TOKENS = 5;
			const displayedTokens = unrecognized.slice(0, MAX_REPORTED_TOKENS);
			const remainingCount = unrecognized.length - displayedTokens.length;
			const formattedTokens = displayedTokens
				.map(
					(token) =>
						`\`${token.length > 20 ? `${token.slice(0, 20)}…` : token}\``,
				)
				.join(', ');
			const tokenSummary =
				remainingCount > 0
					? `${formattedTokens}, and ${remainingCount} more`
					: formattedTokens;
			const mentionWarning =
				unrecognized.length > 0
					? `⚠️ Ignored ${unrecognized.length} unrecognised entr${
							unrecognized.length === 1 ? 'y' : 'ies'
						}: ${tokenSummary}. Mention people or roles with @ so Discord sends them as mentions.`
					: undefined;

			if (mentionWarning) {
				log.warn({ unrecognized }, '⚠️ Unparsed mention tokens in options');
			}

			const { facilitatorMembers, regularMembers } = partitionMembers(
				allTargetMembers.values(),
				excludedUsers,
				facilitators,
			);

			log.info(
				{
					regularCount: regularMembers.length,
					facilitatorCount: facilitatorMembers.length,
					roomsCount: breakoutRooms.length,
				},
				'🧩 Calculating distribution plan',
			);

			const distribution = distributeUsers(
				regularMembers,
				breakoutRooms,
				facilitatorMembers,
			);

			log.debug('📝 Creating preview embed');
			const previewEmbed = buildDistributionEmbed({
				mainRoom,
				breakoutRooms,
				facilitators,
				excludedUsers,
				usersInMainRoom: mainRoom.members,
				distribution,
				isPreview: true,
			});

			const confirmButton = new ButtonBuilder()
				.setCustomId('confirm_distribute')
				.setLabel('Confirm')
				.setStyle(ButtonStyle.Success);

			const cancelButton = new ButtonBuilder()
				.setCustomId('cancel_distribute')
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Secondary);

			await runDistributionCollector({
				interaction,
				ctx,
				mainRoom,
				breakoutRooms,
				facilitators,
				excludedUsers,
				distribution,
				previewEmbed,
				confirmButton,
				cancelButton,
				mentionWarning,
				log,
			});
		},
		{ deferReply: true, ephemeral: true, handlerTimeoutMs: 120_000 },
	);
}
