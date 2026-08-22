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
	getCurrentOperation,
	hasOperationInProgress,
} from '@/modules/breakout/state/state.js';
import type { Command } from '@/types/index.js';

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
						.addChoices(
							{ name: '3 seconds (Testing)', value: '0.05' },
							{ name: '20 minutes (Reminders at 10m, 5m)', value: '20' },
							{ name: '30 minutes (Reminders at 15m, 5m)', value: '30' },
							{ name: '45 minutes (Reminders at 22m, 10m, 3m)', value: '45' },
							{ name: '60 minutes (Reminders at 30m, 15m, 5m)', value: '60' },
							{ name: '90 minutes (Reminders at 45m, 20m, 5m)', value: '90' },
						),
				)
				.addIntegerOption((option) =>
					option
						.setName('custom_minutes')
						.setDescription(
							'Custom FGD timer duration in minutes (minimum 30 minutes)',
						)
						.setMinValue(30)
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

		// Check for interrupted operations (exempt status command)
		if (subcommand !== 'status') {
			const inProgress = await hasOperationInProgress(interaction.guildId);
			if (inProgress) {
				const currentOp = await getCurrentOperation(interaction.guildId);

				if (currentOp && currentOp.type !== subcommand) {
					log.warn(
						{ currentType: currentOp.type, requestedType: subcommand },
						'⚠️ Found interrupted operation, but user requested different type',
					);
					await replyOrEdit(interaction, {
						content: `There is an interrupted '${currentOp.type}' operation in progress. Please finish it or clear it before starting a '${subcommand}' operation.`,
						ephemeral: true,
					});
					return;
				}
				if (currentOp && currentOp.type === subcommand) {
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
