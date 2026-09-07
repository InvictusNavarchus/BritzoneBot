import type {
	Client,
	Guild,
	Message,
	StageChannel,
	VoiceBasedChannel,
	VoiceChannel,
} from 'discord.js';
import type { Logger } from 'pino';
import {
	getDiscordErrorCode,
	isPermanentDiscordFailure,
} from '@/lib/discord/errors.js';
import { logger } from '@/lib/logger.js';
import {
	formatReminderMessage,
	getTimerSchedule,
} from '@/modules/breakout/constants/timerPresets.js';
import { moveUserToRoom } from '@/modules/breakout/services/distribution.js';
import {
	clearTimerData,
	getTimerData,
	markReminderSent,
	type TimerData,
} from '@/modules/breakout/state/state.js';

// Track active in-memory timer cleanup functions per guild
const activeTimerCleanups = new Map<
	string,
	(cleanMessages?: boolean) => Promise<void>
>();

/**
 * Cancels any active timer timeouts for a guild and clears persistent timer state.
 *
 * @param guildId The ID of the guild
 * @returns true if an active timer was running or present in state and was canceled, false otherwise
 */
export async function cancelBreakoutTimer(guildId: string): Promise<boolean> {
	const cleanup = activeTimerCleanups.get(guildId);
	if (cleanup) {
		await cleanup(true);
	}
	const timerState = await getTimerData(guildId);
	await clearTimerData(guildId);
	return Boolean(cleanup || timerState);
}

/**
 * Monitors a breakout timer and sends reminders at exact target times using targeted timeouts.
 *
 * @param timerData Timer configuration data
 * @param client The Discord client instance
 */
export async function monitorBreakoutTimer(
	timerData: TimerData,
	client: Client,
): Promise<void> {
	const { timerId, totalMinutes, startTime, guildId, breakoutRooms } =
		timerData;
	const endTime = startTime + totalMinutes * 60 * 1000;
	const gracePeriodSeconds = timerData.autoRecall
		? (timerData.gracePeriodSeconds ?? 60)
		: 0;
	const gracePeriodMs = gracePeriodSeconds * 1000;
	const recallTime = endTime + gracePeriodMs;
	const log = logger.child({ guildId, timerId });

	// Cancel any previously scheduled timer timeouts and clean up sent messages for this guild
	const prevCleanup = activeTimerCleanups.get(guildId);
	if (prevCleanup) {
		await prevCleanup(true);
	}

	const timeouts: NodeJS.Timeout[] = [];

	/**
	 * Live countdown messages only — the "moving members back <relative time>"
	 * notices whose relative timestamp goes stale the moment the timer is
	 * cancelled or replaced.
	 *
	 * Intermediate reminders ("15 minutes remaining") are deliberately absent:
	 * they are an accurate record of what participants were told and stay in the
	 * room. Tracking them here meant cancelling or replacing a timer wiped the
	 * whole reminder history out of every breakout room.
	 */
	const countdownMessages: Message[] = [];
	const cleanup = async (cleanMessages = false) => {
		for (const t of timeouts) {
			clearTimeout(t);
		}
		if (cleanMessages) {
			for (const msg of countdownMessages) {
				try {
					await msg.delete();
					log.info({ messageId: msg.id }, '🗑️ Deleted stale countdown message');
				} catch (err) {
					log.debug(
						{ err, messageId: msg.id },
						'⚠️ Could not delete stale countdown message',
					);
				}
			}
		}
		activeTimerCleanups.delete(guildId);
	};
	activeTimerCleanups.set(guildId, cleanup);

	const now = Date.now();

	const executeAutoRecall = async (targetMainRoomId?: string) => {
		if (timerData.autoRecall && targetMainRoomId) {
			const guild = client.guilds.cache.get(guildId);
			const mainChannel = guild?.channels.cache.get(targetMainRoomId);
			if (guild && mainChannel?.isVoiceBased()) {
				log.info({ mainRoom: mainChannel.name }, '🔁 Auto-recalling members');
				await autoRecallMembers(guild, breakoutRooms, mainChannel, log);
			} else {
				log.warn(
					'⚠️ Main room no longer exists or guild not cached; skipping auto-recall',
				);
			}
		}
	};

	// 1. Expired while offline/restarting or past recall time
	if (now >= recallTime) {
		log.info(
			'⏱️ Timer and grace period expired during offline window or past recall time. Sending completion notice.',
		);
		await sendReminderWithRetry(
			log,
			guildId,
			breakoutRooms,
			"⏰ **Time's up!** This breakout session has ended.",
			client,
		);
		await executeAutoRecall(timerData.mainRoomId);
		await clearTimerData(guildId);
		await cleanup();
		return;
	}

	// 1b. Expired main timer while offline, but still inside grace period window
	if (now >= endTime) {
		const remainingGrace = recallTime - now;
		const recallUnix = Math.floor(recallTime / 1000);
		log.info(
			{ remainingGraceMs: remainingGrace },
			'⏱️ Timer expired offline, currently in grace period window.',
		);
		const sentMessages = await sendReminderWithRetry(
			log,
			guildId,
			breakoutRooms,
			`⏰ **Time's up!** This breakout session has ended.\n⏳ Moving all members back to the main room <t:${recallUnix}:R>...`,
			client,
		);
		for (const msg of sentMessages.values()) {
			countdownMessages.push(msg);
		}
		const tGrace = setTimeout(async () => {
			try {
				const state = await getTimerData(guildId);
				if (!state || (timerId && state.timerId !== timerId)) return;
				await executeAutoRecall(state.mainRoomId);
				await updateSentMessages(
					log,
					sentMessages,
					"⏰ **Time's up!** This breakout session has ended.\n✅ Moving all members back to the main room now.",
				);
				await clearTimerData(guildId);
				await cleanup();
			} catch (error) {
				log.error(
					{ err: error, timerId },
					'❌ Error in grace period completion callback',
				);
			}
		}, remainingGrace);
		timeouts.push(tGrace);
		return;
	}

	// 2. Schedule intermediate reminders from lookup/calculated schedule
	const schedule = getTimerSchedule(totalMinutes);
	const sentReminders = new Set<number>(timerData.sentReminders ?? []);

	for (const remainingMinutes of schedule) {
		const reminderTime = endTime - remainingMinutes * 60 * 1000;
		const delay = reminderTime - now;
		const message = formatReminderMessage(remainingMinutes);

		if (sentReminders.has(remainingMinutes)) {
			continue;
		}

		if (delay > 0) {
			const t = setTimeout(async () => {
				try {
					const state = await getTimerData(guildId);
					if (!state || (timerId && state.timerId !== timerId)) return;

					log.info(
						{ roomCount: breakoutRooms.length, remainingMinutes },
						`⏱️ Sending ${remainingMinutes}-minute reminder`,
					);
					await sendReminderWithRetry(
						log,
						guildId,
						breakoutRooms,
						message,
						client,
					);
					if (timerId) {
						await markReminderSent(guildId, timerId, remainingMinutes);
					}
				} catch (error) {
					log.error(
						{ err: error, remainingMinutes, timerId },
						`❌ Error in ${remainingMinutes}-minute reminder callback`,
					);
				}
			}, delay);
			timeouts.push(t);
		} else {
			// Catch-up: send immediately if missed while offline
			log.info(
				{ remainingMinutes },
				`⏱️ Missed ${remainingMinutes}-minute warning while offline. Sending catch-up notice.`,
			);
			await sendReminderWithRetry(log, guildId, breakoutRooms, message, client);
			if (timerId) {
				await markReminderSent(guildId, timerId, remainingMinutes);
			}
			sentReminders.add(remainingMinutes);
		}
	}

	// 3. Time's Up
	const endDelay = endTime - now;
	const tEnd = setTimeout(async () => {
		try {
			const state = await getTimerData(guildId);
			if (!state || (timerId && state.timerId !== timerId)) return;

			log.info('⏱️ Breakout timer ended');

			if (state.autoRecall && state.mainRoomId && gracePeriodSeconds > 0) {
				const recallUnix = Math.floor((Date.now() + gracePeriodMs) / 1000);
				const sentMessages = await sendReminderWithRetry(
					log,
					guildId,
					breakoutRooms,
					`⏰ **Time's up!** This breakout session has ended.\n⏳ Moving all members back to the main room <t:${recallUnix}:R>...`,
					client,
				);
				for (const msg of sentMessages.values()) {
					countdownMessages.push(msg);
				}

				const tGrace = setTimeout(async () => {
					try {
						const currentState = await getTimerData(guildId);
						if (!currentState || (timerId && currentState.timerId !== timerId))
							return;

						await executeAutoRecall(currentState.mainRoomId);
						await updateSentMessages(
							log,
							sentMessages,
							"⏰ **Time's up!** This breakout session has ended.\n✅ Moving all members back to the main room now.",
						);
						await clearTimerData(guildId);
						await cleanup();
					} catch (error) {
						log.error(
							{ err: error, timerId },
							'❌ Error in grace period auto-recall callback',
						);
					}
				}, gracePeriodMs);
				timeouts.push(tGrace);
			} else {
				await sendReminderWithRetry(
					log,
					guildId,
					breakoutRooms,
					"⏰ **Time's up!** This breakout session has ended.",
					client,
				);
				await executeAutoRecall(state.mainRoomId);
				await clearTimerData(guildId);
				await cleanup();
			}
		} catch (error) {
			log.error(
				{ err: error, timerId },
				'❌ Error in breakout timer completion callback',
			);
		}
	}, endDelay);
	timeouts.push(tEnd);

	log.info(
		{
			totalMinutes,
			gracePeriodSeconds,
			endDelayMs: endDelay,
			scheduledReminders: schedule.length,
		},
		'⏱️ Targeted breakout timer scheduled',
	);
}

/**
 * Recalls members from breakout rooms to the specified main room
 */
async function autoRecallMembers(
	guild: Guild,
	roomIds: string[],
	mainChannel: VoiceBasedChannel,
	log: Logger,
): Promise<void> {
	let moved = 0;
	for (const roomId of roomIds) {
		const room = guild.channels.cache.get(roomId);
		if (!room || !room.isVoiceBased()) continue;

		for (const member of room.members.values()) {
			try {
				await moveUserToRoom(
					member,
					mainChannel as VoiceChannel | StageChannel,
				);
				moved++;
			} catch (err) {
				log.warn({ memberId: member.id, err }, 'Failed to auto-recall member');
			}
		}
	}
	log.info({ moved }, '✅ Auto-recall complete');
}

/**
 * Updates previously sent reminder messages with a new content.
 */
async function updateSentMessages(
	log: Logger,
	sentMessages: Map<string, Message>,
	newMessage: string,
): Promise<void> {
	for (const [roomId, msg] of sentMessages.entries()) {
		try {
			await msg.edit(newMessage);
			log.info({ roomId }, '✅ Updated countdown message to completion');
		} catch (err) {
			log.warn(
				{ roomId, err },
				'⚠️ Could not update countdown message after recall',
			);
		}
	}
}

/**
 * Sends a reminder message to associated text channels with retry logic.
 *
 * @param guildId The ID of the guild
 * @param roomIds Array of voice channel IDs
 * @param message The reminder message to be sent
 * @param client The Discord.js client instance
 */
async function sendReminderWithRetry(
	log: Logger,
	guildId: string,
	roomIds: string[],
	message: string,
	client: Client,
): Promise<Map<string, Message>> {
	const sentMessages = new Map<string, Message>();
	const guild = client.guilds.cache.get(guildId);
	if (!guild) {
		logger.error({ guildId }, `❌ Could not find guild`);
		return sentMessages;
	}

	const maxRetries = 5;

	for (const roomId of roomIds) {
		const voiceChannel = guild.channels.cache.get(roomId);
		if (!voiceChannel) {
			log.warn({ roomId }, `⚠️ Could not find voice channel`);
			continue;
		}

		// assume the voice channel has integrated text channel
		const textChannel = voiceChannel;

		// Type guard: ensure it's a text channel before sending
		if (!textChannel.isTextBased()) {
			log.warn({ channelId: textChannel.id }, `⚠️ Channel is not text-based`);
			continue;
		}
		let success = false;
		let attempts = 0;

		while (!success && attempts < maxRetries) {
			try {
				const sentMsg = await textChannel.send(message);
				sentMessages.set(roomId, sentMsg);
				success = true;
				log.info({ channel: textChannel.name }, `✅ Reminder sent`);
			} catch (error) {
				attempts++;

				// A deleted channel or a missing permission fails identically on
				// every attempt. Retrying it burns the backoff budget inside a
				// setTimeout callback and stalls every room queued behind this one —
				// ten misconfigured rooms would block for minutes.
				if (isPermanentDiscordFailure(error)) {
					log.error(
						{
							err: error,
							code: getDiscordErrorCode(error),
							channel: textChannel.name,
						},
						`❌ Reminder cannot be delivered to this room; not retrying`,
					);
					break;
				}

				log.error(
					{
						err: error,
						attempt: attempts,
						maxRetries,
						channel: textChannel.name,
					},
					`❌ Failed to send reminder`,
				);

				if (attempts < maxRetries) {
					// Exponential backoff
					const delay = Math.min(1000 * 2 ** attempts, 10000);
					log.debug({ delay: delay / 1000 }, `🔄 Retrying reminder send`);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		if (!success) {
			log.error(
				{ channel: textChannel.name, attempts },
				`❌ Gave up sending reminder to room`,
			);
		}
	}

	return sentMessages;
}
