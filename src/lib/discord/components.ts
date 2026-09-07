import { logger } from '@/lib/logger.js';

/**
 * Callback that neutralises one prompt's components and explains why.
 */
type DisableComponents = () => Promise<void>;

const activePrompts = new Set<DisableComponents>();

/**
 * Registers a live component prompt so it can be neutralised on shutdown.
 *
 * Message component collectors live only in the process that created them. When
 * the bot restarts, every outstanding Confirm/Cancel prompt becomes inert:
 * clicking it produces Discord's bare "This interaction failed", with nothing
 * to say whether the action happened, is still running, or was lost. Tracking
 * the prompts lets graceful shutdown replace that dead end with an explanation.
 *
 * @param disable Neutralises the prompt — clears its components and says why.
 * @returns An unregister function to call once the prompt resolves normally.
 */
export function trackInteractivePrompt(disable: DisableComponents): () => void {
	activePrompts.add(disable);
	return () => {
		activePrompts.delete(disable);
	};
}

/**
 * Neutralises every prompt still awaiting input.
 *
 * Failures are logged and swallowed: shutdown must not stall because one
 * message was deleted or the channel became unreachable.
 */
export async function disableActivePrompts(): Promise<void> {
	if (activePrompts.size === 0) return;

	const prompts = Array.from(activePrompts);
	activePrompts.clear();
	logger.info(
		{ count: prompts.length },
		'🔘 Disabling interactive prompts before shutdown',
	);

	await Promise.all(
		prompts.map(async (disable) => {
			try {
				await disable();
			} catch (err) {
				logger.debug({ err }, '⚠️ Could not disable an interactive prompt');
			}
		}),
	);
}

/** Number of prompts currently awaiting input. Exposed for tests. */
export function activePromptCount(): number {
	return activePrompts.size;
}
