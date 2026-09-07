/**
 * @fileoverview Discord interaction response and lifecycle management.
 *
 * ## Architecture Overview
 * This module provides a 2-tier abstraction for responding to Discord interactions:
 *
 * 1. **High-Level Context (`handleInteraction` + `InteractionContext`):**
 *    Preferred for all command and subcommand handlers. It wraps the execution inside a
 *    safe timeout race, manages interaction deferrals (`deferReply`), handles automatic error
 *    reporting if the handler fails, and provides an ergonomic `ctx` object with intent-based
 *    helpers (`ctx.reply()`, `ctx.editReply()`, `ctx.sendPublic()`).
 *
 * 2. **Low-Level State Dispatch (`replyOrEdit`):**
 *    A stateless utility that dynamically branches between `interaction.reply()` and
 *    `interaction.editReply()` based on the interaction's current state (`.replied` / `.deferred`).
 *    Used internally by `ctx.reply()` and externally in standalone contexts (e.g. event listeners,
 *    confirmation prompts, preflight permission guards).
 */

import type {
	CommandInteraction,
	InteractionEditReplyOptions,
	InteractionReplyOptions,
	Message,
	RepliableInteraction,
} from 'discord.js';
import { MessageFlags, MessagePayload } from 'discord.js';
import { logger } from '@/lib/logger.js';

/**
 * Configuration options for the `handleInteraction` lifecycle wrapper.
 */
export interface InteractionHandlerOptions {
	/**
	 * Whether to automatically defer the reply before executing the handler.
	 * Recommended for long-running operations or commands with interactive prompts.
	 * @default false
	 */
	deferReply?: boolean;

	/**
	 * Whether the interaction response should only be visible to the user who invoked it.
	 * Automatically applied to `deferReply` if deferred, or to the initial `ctx.reply()` if not.
	 * @default false
	 */
	ephemeral?: boolean;

	/**
	 * Maximum time in milliseconds to wait for `deferReply()` before timing out.
	 * Discord requires an initial acknowledgement within 3000ms.
	 * @default 2500
	 */
	deferTimeoutMs?: number;

	/**
	 * Maximum time in milliseconds to allow the handler to execute before timing out.
	 * @default 15000 (15 seconds)
	 */
	handlerTimeoutMs?: number;

	/**
	 * Fallback user-facing error message sent if the handler throws an uncaught error or times out.
	 * @default '❌ An error occurred while processing this command.'
	 */
	errorMessage?: string;

	/**
	 * Whether to automatically send an error message to the user when the handler throws or times out.
	 * Set to `false` if the handler performs its own complete error reporting.
	 * @default true
	 */
	notifyOnError?: boolean;
}

/**
 * Options that extend Discord's InteractionReplyOptions to support a friendly `ephemeral` boolean directive.
 */
export interface ExtendedInteractionReplyOptions
	extends Omit<InteractionReplyOptions, 'flags'> {
	flags?: InteractionReplyOptions['flags'];
	ephemeral?: boolean;
}

/**
 * Valid payload formats acceptable when sending replies or editing responses.
 */
export type ResponsePayload =
	| string
	| ExtendedInteractionReplyOptions
	| InteractionEditReplyOptions
	| MessagePayload;

/**
 * Unified context passed into interaction handlers, providing intent-based response methods
 * and encapsulating Discord's internal reply/deferral state machine.
 */
export interface InteractionContext<
	T extends RepliableInteraction | CommandInteraction =
		| RepliableInteraction
		| CommandInteraction,
> {
	/**
	 * The raw Discord interaction instance.
	 */
	readonly interaction: T;

	/**
	 * Whether the interaction has been acknowledged via `deferReply()`.
	 */
	readonly isDeferred: boolean;

	/**
	 * Whether ephemeral responses were requested in `handleInteraction` options.
	 */
	readonly isEphemeral: boolean;

	/**
	 * Responds to the interaction with automatic state management.
	 *
	 * - **Fresh Interaction:** Calls `interaction.reply()`, automatically applying the configured
	 *   `ephemeral` flag if set in `handleInteraction` options.
	 * - **Deferred / Replied Interaction:** Calls `interaction.editReply()`.
	 * - **Idempotent Updates:** Can be called repeatedly within a handler to update a progress message
	 *   (e.g., `await ctx.reply('⏳ Working...')` followed by `await ctx.reply('✅ Done!')`).
	 *
	 * @param content The response message content, embeds, or options to send.
	 * @returns Promise resolving to the sent or edited Discord `Message`.
	 */
	reply: (content: ResponsePayload) => Promise<Message>;

	/**
	 * Directly edits the original interaction response.
	 * Useful when explicitly modifying components (e.g. disabling buttons) or clearing embeds.
	 *
	 * @param content The updated content or options.
	 * @returns Promise resolving to the edited Discord `Message`.
	 */
	editReply: (
		content: InteractionEditReplyOptions | MessagePayload | string,
	) => Promise<Message>;

	/**
	 * Sends a public announcement to the text channel where the interaction occurred.
	 * Fails gracefully without throwing errors if the channel lacks permissions or is non-text.
	 *
	 * @param options Content or message options to send to the channel.
	 * @returns Promise resolving to the sent Message or null if failed/unsupported.
	 */
	sendPublic: (
		options: string | MessagePayload | InteractionReplyOptions,
	) => Promise<Message | null>;

	/**
	 * Restarts the handler's timeout budget from now.
	 *
	 * The budget is meant to bound the bot's *own* work, but it also covered
	 * time spent waiting on a human: a distribute handler's 120s allowance
	 * included the 60s the confirmation collector sits idle, so a large room
	 * confirmed late could trip the timeout, tell the user it failed, and then
	 * carry on moving members with a second editReply racing the error message.
	 *
	 * Call this once the wait is over — after a confirmation is collected — so
	 * the work that follows is measured on its own.
	 */
	restartTimeout: () => void;
}

/**
 * Async handler callback receiving a unified `InteractionContext`.
 */
export type InteractionHandler<
	T extends RepliableInteraction | CommandInteraction =
		| RepliableInteraction
		| CommandInteraction,
> = (ctx: InteractionContext<T>) => Promise<void>;

/**
 * Custom error indicating an operation timed out.
 */
export class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TimeoutError';
	}
}

/**
 * Safely extracts an error code from an Error object if present.
 * @param error The error to extract code from.
 * @returns The error code if present, otherwise undefined.
 */
function getErrorCode(error: Error): string | number | undefined {
	return 'code' in error
		? (error as Error & { code?: string | number }).code
		: undefined;
}

/**
 * A restartable timeout, used to bound handler execution.
 */
interface TimeoutBudget {
	/** Rejects with a {@link TimeoutError} once the budget elapses. */
	readonly promise: Promise<never>;
	/** Discards the elapsed time and starts the budget again from now. */
	restart(): void;
	/** Cancels the pending timer. */
	clear(): void;
}

/**
 * Creates a timeout that can be restarted while the task is still running.
 */
function createTimeoutBudget(
	timeoutMs: number,
	timeoutErrorMessage: string,
): TimeoutBudget {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let arm: () => void = () => {};

	const promise = new Promise<never>((_, reject) => {
		arm = () => {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			timeoutId = setTimeout(
				() => reject(new TimeoutError(timeoutErrorMessage)),
				timeoutMs,
			);
		};
		arm();
	});

	return {
		promise,
		restart: () => arm(),
		clear: () => {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
		},
	};
}

/**
 * Executes an async task with timeout protection, guaranteeing that the timer is cleared.
 */
async function executeWithTimeout<T>(
	task: () => Promise<T>,
	timeoutMs: number,
	timeoutErrorMessage: string,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(
				() => reject(new TimeoutError(timeoutErrorMessage)),
				timeoutMs,
			);
		});

		return await Promise.race([task(), timeoutPromise]);
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}

/**
 * Safely defers an interaction with timeout protection and network error containment.
 */
async function safeDeferReply(
	interaction: RepliableInteraction | CommandInteraction,
	ephemeral: boolean,
	timeoutMs: number,
): Promise<boolean> {
	try {
		await executeWithTimeout(
			() =>
				interaction.deferReply(
					ephemeral ? { flags: MessageFlags.Ephemeral } : undefined,
				),
			timeoutMs,
			'Defer reply timeout',
		);
		logger.debug(
			{ interactionId: interaction.id },
			'🔄 Successfully deferred interaction',
		);
		return true;
	} catch (deferError) {
		const error =
			deferError instanceof Error ? deferError : new Error(String(deferError));
		const errorCode = getErrorCode(error);

		if (errorCode === 10062) {
			logger.warn(
				{ interactionId: interaction.id },
				'⏱️ Interaction expired before deferring',
			);
			return false;
		}

		if (errorCode === 'EAI_AGAIN' || error instanceof TimeoutError) {
			logger.warn(
				{ interactionId: interaction.id, err: error },
				'🌐 Network issue or timeout while deferring interaction',
			);
			return false;
		}

		logger.error(
			{ interactionId: interaction.id, err: error },
			'❓ Unknown error while deferring interaction',
		);
		return false;
	}
}

/**
 * Creates the unified `InteractionContext` instance passed to interaction handlers.
 */
function createInteractionContext<
	T extends RepliableInteraction | CommandInteraction,
>(
	interaction: T,
	ephemeral: boolean,
	restartTimeout: () => void,
): InteractionContext<T> {
	return {
		interaction,
		get isDeferred() {
			return interaction.deferred;
		},
		isEphemeral: ephemeral,
		reply: (content: ResponsePayload) => {
			if (!interaction.replied && !interaction.deferred && ephemeral) {
				if (typeof content === 'string') {
					return replyOrEdit(interaction, { content, ephemeral: true });
				}
				if (content instanceof MessagePayload) {
					return replyOrEdit(interaction, content);
				}
				const payload: ExtendedInteractionReplyOptions = {
					ephemeral: true,
					...(content as ExtendedInteractionReplyOptions),
				};
				return replyOrEdit(interaction, payload);
			}
			return replyOrEdit(interaction, content);
		},
		editReply: (content) => {
			return replyOrEdit(interaction, content);
		},
		sendPublic: (content) => {
			return sendPublicAnnouncement(interaction, content);
		},
		restartTimeout,
	};
}

/**
 * Handles execution failure by logging structured errors and notifying the user if enabled.
 */
async function handleExecutionFailure(
	interaction: RepliableInteraction | CommandInteraction,
	error: unknown,
	errorMessage: string,
	ephemeral: boolean,
	notifyOnError: boolean,
): Promise<void> {
	const err = error instanceof Error ? error : new Error(String(error));
	logger.error(
		{ interactionId: interaction.id, err },
		'❌ Handler error for interaction',
	);

	if (notifyOnError) {
		try {
			await replyOrEdit(interaction, {
				content: errorMessage,
				ephemeral: ephemeral ? true : undefined,
			});
		} catch (notifyErr) {
			logger.warn(
				{ interactionId: interaction.id, err: notifyErr },
				'⚠️ Failed to send error notification to interaction',
			);
		}
	}
}

/**
 * Orchestrates interaction execution with built-in lifecycle management, deferrals,
 * timeout races, uncaught error containment, and automatic failure notification.
 *
 * @param interaction The Discord interaction to handle.
 * @param handler Async function receiving a unified `InteractionContext`.
 * @param options Lifecycle, timeout, and notification options.
 * @returns Promise resolving to `true` on successful completion, or `false` if an error/timeout occurred.
 */
export async function handleInteraction<
	T extends RepliableInteraction | CommandInteraction =
		| RepliableInteraction
		| CommandInteraction,
>(
	interaction: T,
	handler: InteractionHandler<T>,
	options: InteractionHandlerOptions = {},
): Promise<boolean> {
	const {
		deferReply = false,
		ephemeral = false,
		deferTimeoutMs = 2500,
		handlerTimeoutMs = 15000,
		errorMessage = '❌ An error occurred while processing this command.',
		notifyOnError = true,
	} = options;

	try {
		// 1. Defer interaction if requested and not yet acknowledged
		if (deferReply && !interaction.replied && !interaction.deferred) {
			const deferred = await safeDeferReply(
				interaction,
				ephemeral,
				deferTimeoutMs,
			);
			if (!deferred) return false;
		}

		// 2. Build context and execute handler with restartable timeout protection
		const budget = createTimeoutBudget(
			handlerTimeoutMs,
			'Handler execution timeout',
		);
		const ctx = createInteractionContext(
			interaction,
			ephemeral,
			budget.restart,
		);
		try {
			await Promise.race([handler(ctx), budget.promise]);
		} finally {
			budget.clear();
		}
		return true;
	} catch (error) {
		// 3. Contain failure, log, and send fallback notification if enabled
		await handleExecutionFailure(
			interaction,
			error,
			errorMessage,
			ephemeral,
			notifyOnError,
		);
		return false;
	}
}

/**
 * Safely extracts a Message from an interaction.reply() response object if present.
 */
function extractMessageFromReply(res: unknown): Message | null {
	if (
		res &&
		typeof res === 'object' &&
		'resource' in res &&
		res.resource &&
		typeof res.resource === 'object' &&
		'message' in res.resource &&
		res.resource.message
	) {
		return res.resource.message as Message;
	}
	if (res && typeof res === 'object' && 'id' in res) {
		return res as Message;
	}
	return null;
}

/**
 * Resolves a Message from the reply result or falls back to fetchReply if supported.
 */
async function resolveMessageFromReply(
	interaction: RepliableInteraction | CommandInteraction,
	res: unknown,
): Promise<Message> {
	const extracted = extractMessageFromReply(res);
	if (extracted) return extracted;

	if (
		'fetchReply' in interaction &&
		typeof interaction.fetchReply === 'function'
	) {
		return await interaction.fetchReply();
	}

	return res as Message;
}

/**
 * Low-level polymorphic dispatch utility for sending interaction replies.
 *
 * Automatically inspects `interaction.replied` and `interaction.deferred`:
 * - If already replied or deferred: executes `interaction.editReply(...)`.
 * - If untouched: executes `interaction.reply({ ..., withResponse: true })`.
 *
 * Use this helper in standalone contexts outside `handleInteraction` (e.g. event listeners,
 * confirmation collectors, or preflight permission guards).
 *
 * @param interaction The Discord interaction to respond to.
 * @param content The response content, embeds, or options.
 * @returns Promise resolving to the sent or edited Discord `Message`.
 */
export async function replyOrEdit(
	interaction: RepliableInteraction | CommandInteraction,
	content: ResponsePayload,
): Promise<Message> {
	if (interaction.replied || interaction.deferred) {
		if (
			typeof content === 'object' &&
			content !== null &&
			!(content instanceof MessagePayload)
		) {
			const { ephemeral: _, ...cleanEditOptions } =
				content as ExtendedInteractionReplyOptions;
			return (await interaction.editReply(
				cleanEditOptions as InteractionEditReplyOptions,
			)) as Message;
		}
		return (await interaction.editReply(
			content as InteractionEditReplyOptions,
		)) as Message;
	}

	if (typeof content === 'string') {
		const res = await interaction.reply({
			content,
			withResponse: true,
		});
		return await resolveMessageFromReply(interaction, res);
	}

	if (content instanceof MessagePayload) {
		const res = await interaction.reply(content);
		return await resolveMessageFromReply(interaction, res);
	}

	const rawOptions = content as ExtendedInteractionReplyOptions;
	const { ephemeral: isEphemeral, ...cleanOptions } = rawOptions;
	const options: InteractionReplyOptions = {
		...cleanOptions,
		withResponse: true,
	};

	if (isEphemeral) {
		options.flags =
			(typeof options.flags === 'number' ? options.flags : 0) |
			MessageFlags.Ephemeral;
	}

	const res = await interaction.reply(options);
	return await resolveMessageFromReply(interaction, res);
}

/**
 * Sends a public message to the text channel where the interaction occurred.
 * Fails gracefully without throwing errors if the channel doesn't support sending messages or lacks permissions.
 *
 * @param interaction The Discord interaction.
 * @param options Content or message options to send.
 * @returns Promise resolving to the sent Message or null if failed/unsupported.
 */
export async function sendPublicAnnouncement(
	interaction: RepliableInteraction | CommandInteraction,
	options: string | MessagePayload | InteractionReplyOptions,
): Promise<Message | null> {
	try {
		const channel = interaction.channel;
		if (channel && 'send' in channel && typeof channel.send === 'function') {
			return await channel.send(options as Parameters<typeof channel.send>[0]);
		}
	} catch (err) {
		logger.warn(
			{ interactionId: interaction.id, err },
			'⚠️ Failed to send public announcement to channel',
		);
	}
	return null;
}
