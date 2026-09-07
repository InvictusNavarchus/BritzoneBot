import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
	ComponentType,
} from 'discord.js';
import { replyOrEdit } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';

export interface ConfirmActionOptions {
	interaction: ChatInputCommandInteraction;
	content: string;
	confirmLabel: string;
	cancelLabel?: string;
	loadingContent?: string;
	onConfirm: () => Promise<void>;
	onCancel?: () => Promise<void>;
	timeMs?: number;
	/**
	 * Called once the user has answered, before `onConfirm` runs.
	 *
	 * Callers running inside `handleInteraction` pass `ctx.restartTimeout` here,
	 * so the time this prompt spent idle is not charged against the work that
	 * follows it.
	 */
	onInteractionCollected?: () => void;
}

/**
 * Displays an interactive confirmation prompt with Danger/Cancel buttons
 * and safely awaits the user's response.
 */
export async function confirmAction(
	options: ConfirmActionOptions,
): Promise<boolean> {
	const {
		interaction,
		content,
		confirmLabel,
		cancelLabel = 'Cancel',
		loadingContent = '⏳ Processing...',
		onConfirm,
		onCancel,
		timeMs = 60_000,
		onInteractionCollected,
	} = options;

	const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('confirm_action')
			.setLabel(confirmLabel)
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('cancel_action')
			.setLabel(cancelLabel)
			.setStyle(ButtonStyle.Secondary),
	);

	const response = await replyOrEdit(interaction, {
		content,
		components: [confirmRow],
	});

	const collector = response.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: timeMs,
	});

	return new Promise<boolean>((resolve) => {
		collector.on('collect', async (i) => {
			try {
				if (i.user.id !== interaction.user.id) {
					await replyOrEdit(i, {
						content: 'You are not authorized to interact with this prompt.',
						ephemeral: true,
					});
					return;
				}

				if (i.customId === 'cancel_action') {
					collector.stop('cancelled');
					await i.update({
						content: '❌ Action cancelled.',
						components: [],
					});
					if (onCancel) {
						await onCancel();
					}
					resolve(false);
					return;
				}

				if (i.customId === 'confirm_action') {
					collector.stop('confirmed');
					onInteractionCollected?.();
					await i.update({
						content: loadingContent,
						components: [],
					});

					await onConfirm();
					resolve(true);
				}
			} catch (err) {
				logger.error(
					{ err },
					'Failed handling confirmation button interaction',
				);
				resolve(false);
			}
		});

		collector.on('end', async (_, reason) => {
			if (reason !== 'confirmed' && reason !== 'cancelled') {
				try {
					await interaction.editReply({
						content: '⏱️ Request timed out.',
						components: [],
					});
				} catch (err) {
					logger.error({ err }, 'Failed to edit reply on collector timeout');
				}
				resolve(false);
			}
		});
	});
}
