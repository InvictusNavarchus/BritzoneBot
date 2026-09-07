import type { ChatInputCommandInteraction } from 'discord.js';
import { handleInteraction } from '@/lib/discord/response.js';
import { logger } from '@/lib/logger.js';
import { clearCurrentOperation } from '@/modules/breakout/state/state.js';

/**
 * Handles the reset subcommand: discards a stuck operation record.
 *
 * This is the manual counterpart to the automatic staleness expiry — for when a
 * facilitator needs the lock gone now rather than in ten minutes. It clears
 * only the operation record; rooms, members and timers are left exactly as they
 * are, so it is safe to run when unsure.
 */
export async function handleResetCommand(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (!interaction.guildId || !interaction.guild) return;

	await handleInteraction(
		interaction,
		async (ctx) => {
			const guildId = interaction.guildId;
			if (!guildId) return;

			const log = logger.child({ subcommand: 'reset', guildId });

			const cleared = await clearCurrentOperation(guildId);

			if (!cleared) {
				log.info('ℹ️ Reset requested with no operation in progress');
				await ctx.reply(
					'ℹ️ There is no interrupted operation to clear. Use `/breakout status` to see the current session.',
				);
				return;
			}

			const stepCount = Object.keys(cleared.progress.steps).length;
			log.info(
				{ clearedType: cleared.type, stepCount },
				'🧹 Cleared interrupted operation on request',
			);

			await ctx.reply(
				`🧹 Cleared the interrupted \`${cleared.type}\` operation (${stepCount} step${
					stepCount === 1 ? '' : 's'
				} recorded).\nBreakout rooms, members and any active timer are untouched — run \`/breakout status\` to see what still exists.`,
			);
		},
		{ ephemeral: true },
	);
}
