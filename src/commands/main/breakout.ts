import {
	ChannelType,
	type ChatInputCommandInteraction,
	GuildMember,
	SlashCommandBuilder,
} from 'discord.js';
import { preflightBreakout } from '@/lib/discord/permission.js';
import { replyOrEdit } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import {
	MIN_CUSTOM_TIMER_MINUTES,
	TIMER_PRESET_CHOICES,
} from '@/modules/breakout/constants/timerPresets.js';
import {
	handleBroadcastCommand,
	handleCreateCommand,
	handleDeleteCommand,
	handleDistributeCommand,
	handleRecallCommand,
	handleSendMessageCommand,
	handleStatusCommand,
	handleTimerCancelCommand,
	handleTimerCommand,
} from '@/modules/breakout/handlers/index.js';
import {
	type BreakoutSubcommand,
	clearCurrentOperation,
	getCurrentOperation,
	hasOperationInProgress,
	isOperationStale,
	OPERATION_STALE_AFTER_MS,
} from '@/modules/breakout/state/state.js';
import type { Command } from '@/types/index.js';

/**
 * Subcommands that an interrupted operation must never block.
 *
 * The operation lock exists to stop two conflicting mutations of the same rooms
 * and members. These subcommands mutate neither: `status` reads, `timer-cancel`
 * only tears work down, and the two messaging subcommands write to a text
 * channel. Blocking them turned a single wedged operation into a total lockout —
 * a stuck `create` also refused `timer-cancel` and `delete`, leaving no way out
 * short of editing data/breakoutState.json by hand.
 */
const LOCK_EXEMPT_SUBCOMMANDS: ReadonlySet<BreakoutSubcommand> = new Set([
	'status',
	'timer-cancel',
	'broadcast',
	'send-message',
]);

const subcommandHandlers: Record<
	BreakoutSubcommand,
	(interaction: ChatInputCommandInteraction) => Promise<void>
> = {
	create: handleCreateCommand,
	distribute: handleDistributeCommand,
	recall: handleRecallCommand,
	delete: handleDeleteCommand,
	timer: handleTimerCommand,
	'timer-cancel': handleTimerCancelCommand,
	broadcast: handleBroadcastCommand,
	'send-message': handleSendMessageCommand,
	status: handleStatusCommand,
};

const command: Command = {
	data: new SlashCommandBuilder()
		.setName('breakout')
		.setDescription('Manage breakout rooms for your voice channels')
		// Create subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('create')
				.setDescription('Creates multiple breakout voice channels')
				.addIntegerOption((option) =>
					option
						.setName('number')
						.setDescription('Number of breakout rooms to create')
						.setMinValue(1)
						.setRequired(true),
				),
		)
		// Distribute subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('distribute')
				.setDescription('Split members from a main room into breakout rooms')
				.addChannelOption((option) =>
					option
						.setName('mainroom')
						.setDescription(
							'The main voice channel where members are currently located',
						)
						.setRequired(true)
						.addChannelTypes(
							ChannelType.GuildVoice,
							ChannelType.GuildStageVoice,
						),
				)
				.addStringOption((option) =>
					option
						.setName('exclude')
						.setDescription(
							'Users to keep in the main room (mention them with @)',
						)
						.setRequired(false),
				)
				.addStringOption((option) =>
					option
						.setName('facilitators')
						.setDescription(
							'Facilitators to assign into breakout rooms (mention them with @)',
						)
						.setRequired(false),
				),
		)
		// Recall subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('recall')
				.setDescription('Move all members back to the main voice channel')
				.addChannelOption((option) =>
					option
						.setName('mainroom')
						.setDescription(
							'The main voice channel where users should be moved back',
						)
						.setRequired(true)
						.addChannelTypes(
							ChannelType.GuildVoice,
							ChannelType.GuildStageVoice,
						),
				),
		)
		// Delete subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('delete')
				.setDescription('Delete all breakout room channels'),
		)
		// Timer subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('timer')
				.setDescription('Sets a timer for the breakout session')
				.addStringOption((option) =>
					option
						.setName('minutes')
						.setDescription('FGD timer duration preset')
						.setRequired(false)
						.addChoices(...TIMER_PRESET_CHOICES),
				)
				.addIntegerOption((option) =>
					option
						.setName('custom_minutes')
						.setDescription(
							`Custom FGD timer duration in minutes (minimum ${MIN_CUSTOM_TIMER_MINUTES} minutes)`,
						)
						.setMinValue(MIN_CUSTOM_TIMER_MINUTES)
						.setRequired(false),
				)
				.addBooleanOption((option) =>
					option
						.setName('auto_recall')
						.setDescription(
							'Automatically recall members to the main room when the timer ends (default: true)',
						)
						.setRequired(false),
				)
				.addIntegerOption((option) =>
					option
						.setName('grace_period')
						.setDescription(
							'Grace period in seconds before auto-recalling members (default: 60s, set 0 for instant recall)',
						)
						.setMinValue(0)
						.setMaxValue(300)
						.setRequired(false),
				),
		)
		// Timer-cancel subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('timer-cancel')
				.setDescription('Cancels the active breakout session timer'),
		)
		// Status subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('status')
				.setDescription('Display current breakout rooms and timer status'),
		)
		// Broadcast subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('broadcast')
				.setDescription('Broadcasts a message to all breakout rooms')
				.addStringOption((option) =>
					option
						.setName('message')
						.setDescription('The message to broadcast')
						.setRequired(true),
				),
		)
		// Send-message subcommand
		.addSubcommand((subcommand) =>
			subcommand
				.setName('send-message')
				.setDescription('Sends a message to a specific voice channel')
				.addChannelOption((option) =>
					option
						.setName('channel')
						.setDescription('The voice channel to send the message to')
						.addChannelTypes(ChannelType.GuildVoice)
						.setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName('message')
						.setDescription('The message to send')
						.setRequired(true),
				),
		),

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const log = logger.child({
			command: 'breakout',
			interactionId: interaction.id,
			guildId: interaction.guildId,
			user: interaction.user,
		});

		log.info('🚀 Breakout command initiated');

		if (!interaction.guildId || !interaction.member) {
			await replyOrEdit(interaction, {
				content: 'This command can only be used in a server.',
				ephemeral: true,
			});
			return;
		}

		// Base preflight role check — fail closed if member isn't fully hydrated
		if (!(interaction.member instanceof GuildMember)) {
			await replyOrEdit(interaction, {
				content: 'Unable to verify your permissions.',
				ephemeral: true,
			});
			return;
		}

		const check = preflightBreakout({ member: interaction.member });
		if (!check.ok) {
			await replyOrEdit(interaction, {
				content:
					check.reason ?? 'You do not have permission to run this command.',
				ephemeral: true,
			});
			return;
		}

		const subcommand =
			interaction.options.getSubcommand() as BreakoutSubcommand;

		// Check for interrupted operations (read-only and teardown subcommands are
		// exempt, so a wedged operation never removes the escape routes)
		if (!LOCK_EXEMPT_SUBCOMMANDS.has(subcommand)) {
			const inProgress = await hasOperationInProgress(interaction.guildId);
			if (inProgress) {
				const currentOp = await getCurrentOperation(interaction.guildId);

				// An operation that has recorded nothing for a long time is not in
				// progress, it is abandoned — most likely the process died mid-run.
				// Expiring it here means the lock heals itself instead of requiring
				// intervention.
				if (currentOp && isOperationStale(currentOp)) {
					log.warn(
						{ currentType: currentOp.type, requestedType: subcommand },
						'🧹 Expiring stale operation before running requested subcommand',
					);
					await clearCurrentOperation(interaction.guildId);
				} else if (currentOp && currentOp.type !== subcommand) {
					log.warn(
						{ currentType: currentOp.type, requestedType: subcommand },
						'⚠️ Found interrupted operation, but user requested different type',
					);
					await replyOrEdit(interaction, {
						content: `There is an interrupted '${currentOp.type}' operation in progress. Re-run \`/breakout ${currentOp.type}\` to resume it, or wait ${OPERATION_STALE_AFTER_MS / 60_000} minutes without progress for it to expire on its own.`,
						ephemeral: true,
					});
					return;
				} else if (currentOp) {
					log.info(`Note: Resuming ${subcommand} operation.`);
				}
			}
		}

		const handler = subcommandHandlers[subcommand];
		if (!handler) {
			log.error({ subcommand }, '❌ No handler registered for subcommand');
			await replyOrEdit(interaction, {
				content: 'This subcommand is not supported.',
				ephemeral: true,
			});
			return;
		}

		await handler(interaction);
	},
};

export default command;
