import type { TimerData } from '@/modules/breakout/state/state.js';

export type PresetDuration = 0.05 | 20 | 30 | 45 | 60 | 90;

/**
 * Single source of truth lookup table for FGD session timer reminder presets.
 * Maps session duration in minutes to an array of remaining minute thresholds.
 */
export const FGD_TIMER_PRESETS: Record<PresetDuration, number[]> = {
	0.05: [0.03, 0.015],
	20: [10, 5],
	30: [15, 5],
	45: [22, 10, 3],
	60: [30, 15, 5],
	90: [45, 20, 5],
};

/**
 * Shortest duration accepted for a non-preset (custom) timer, in minutes.
 * Presets are exempt: a preset is advertised in the slash command, so it is
 * accepted whatever its length.
 */
export const MIN_CUSTOM_TIMER_MINUTES = 30;

/**
 * Choice labels that cannot be derived from the reminder schedule.
 */
const PRESET_LABEL_OVERRIDES: Partial<Record<PresetDuration, string>> = {
	0.05: '3 seconds (Testing)',
};

/**
 * Returns whether a duration is one of the advertised presets.
 */
export function isPresetDuration(minutes: number): minutes is PresetDuration {
	return minutes in FGD_TIMER_PRESETS;
}

/**
 * Preset durations in ascending order.
 *
 * `Object.keys` orders integer-like keys before the rest, which would put the
 * sub-minute preset last, so the numeric sort is explicit.
 */
export function getPresetDurations(): PresetDuration[] {
	return Object.keys(FGD_TIMER_PRESETS)
		.map(Number)
		.sort((a, b) => a - b) as PresetDuration[];
}

/**
 * Builds the human-readable label for a preset's slash-command choice.
 */
function formatPresetChoiceName(minutes: PresetDuration): string {
	const override = PRESET_LABEL_OVERRIDES[minutes];
	if (override) return override;

	const thresholds = FGD_TIMER_PRESETS[minutes].map((m) => `${m}m`).join(', ');
	return `${minutes} minutes (Reminders at ${thresholds})`;
}

/**
 * Slash-command choices for the timer duration option, derived from
 * {@link FGD_TIMER_PRESETS}.
 *
 * Generating these from the lookup table is what keeps the advertised choices
 * and the accepted durations from drifting apart: adding a preset row adds the
 * choice and widens validation in one step.
 */
export const TIMER_PRESET_CHOICES: { name: string; value: string }[] =
	getPresetDurations().map((minutes) => ({
		name: formatPresetChoiceName(minutes),
		value: String(minutes),
	}));

/**
 * Renders a duration given in minutes as readable prose.
 *
 * Reminder thresholds for the sub-minute testing preset are fractions of a
 * minute (0.03, 0.015), which read as nonsense in minutes — hence the switch to
 * seconds below one minute.
 */
export function formatDuration(minutes: number): string {
	if (minutes < 1) {
		const seconds = Math.round(minutes * 600) / 10;
		return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
	}
	return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * Renders a duration in the compact form used in schedule summaries, e.g.
 * `22m` or `1.8s`.
 */
export function formatDurationShort(minutes: number): string {
	if (minutes < 1) {
		return `${Math.round(minutes * 600) / 10}s`;
	}
	return `${minutes}m`;
}

/**
 * Generates a concise reminder message for participants.
 */
export function formatReminderMessage(remainingMinutes: number): string {
	return `⏱️ **${formatDuration(remainingMinutes)} remaining** in this breakout session.`;
}

/**
 * Get reminder schedule thresholds for a given duration (in minutes).
 * If totalMinutes matches a preset, the exact tuned lookup schedule is returned.
 * For custom durations >= 30 minutes, reminders are scheduled at [min(30, 2/3 D), 10, 5].
 * Durations under 30 minutes (non-preset) return an empty schedule.
 */
export function getTimerSchedule(totalMinutes: number): number[] {
	if (totalMinutes in FGD_TIMER_PRESETS) {
		return FGD_TIMER_PRESETS[totalMinutes as PresetDuration];
	}

	if (totalMinutes < 30) {
		return [];
	}

	const thresholds = new Set<number>();
	const firstReminder = Math.min(30, Math.round((2 / 3) * totalMinutes));
	if (firstReminder > 0 && firstReminder < totalMinutes) {
		thresholds.add(firstReminder);
	}
	if (10 < totalMinutes) {
		thresholds.add(10);
	}
	if (5 < totalMinutes) {
		thresholds.add(5);
	}

	// Return sorted descending (earliest reminder first)
	return Array.from(thresholds).sort((a, b) => b - a);
}

/**
 * Format schedule human readable summary for interaction responses
 */
export function formatScheduleSummary(schedule: number[]): string {
	if (schedule.length === 0) return 'No intermediate reminders scheduled.';
	const parts = schedule.map(formatDurationShort);
	return `Reminders scheduled at ${parts.join(', ')} remaining.`;
}

/**
 * Formats detailed active timer status into a readable markdown response.
 */
export function formatTimerStatus(
	timerData: TimerData,
	now: number = Date.now(),
): string {
	const {
		totalMinutes,
		startTime,
		breakoutRooms,
		autoRecall,
		mainRoomId,
		gracePeriodSeconds = 60,
		sentReminders = [],
		fiveMinSent,
	} = timerData;

	const durationMs = totalMinutes * 60 * 1000;
	const endTime = startTime + durationMs;
	const graceMs = autoRecall ? gracePeriodSeconds * 1000 : 0;
	const recallTime = endTime + graceMs;

	const startUnix = Math.floor(startTime / 1000);
	const endUnix = Math.floor(endTime / 1000);
	const recallUnix = Math.floor(recallTime / 1000);

	const durationText = formatDuration(totalMinutes);

	// Status determination
	let statusText = `🟢 Active (ends <t:${endUnix}:R>)`;
	if (now >= endTime) {
		if (autoRecall) {
			statusText =
				now >= recallTime
					? '🏁 Expired / Session Ended'
					: `⏳ Grace Period (auto-recalling <t:${recallUnix}:R>)`;
		} else {
			statusText = "🏁 Time's up (awaiting manual recall)";
		}
	}

	// Reminders status
	const schedule = getTimerSchedule(totalMinutes);
	const sentSet = new Set<number>(sentReminders);
	if (fiveMinSent) {
		sentSet.add(5);
	}

	let reminderStatus = 'None scheduled';
	if (schedule.length > 0) {
		reminderStatus = schedule
			.map((m) => {
				const label = formatDurationShort(m);
				return sentSet.has(m) ? `✅ ${label} (sent)` : `⏳ ${label} (pending)`;
			})
			.join(', ');
	}

	// Auto-recall text
	let autoRecallText = 'Disabled';
	if (autoRecall && mainRoomId) {
		autoRecallText = `Enabled (<#${mainRoomId}>${
			gracePeriodSeconds > 0
				? ` with ${gracePeriodSeconds}s grace period`
				: ' immediately'
		})`;
	}

	const roomCount = breakoutRooms.length;
	const roomMentions = breakoutRooms.map((id) => `<#${id}>`).join(' ');
	const roomsText =
		roomCount > 0
			? `${roomMentions} (${roomCount} ${roomCount === 1 ? 'room' : 'rooms'})`
			: 'None';

	const lines = [
		'⏱️ **Breakout Timer Status**',
		`• **Status:** ${statusText}`,
		`• **Duration:** ${durationText}`,
		`• **Started:** <t:${startUnix}:T> (<t:${startUnix}:R>)`,
		`• **Target End Time:** <t:${endUnix}:T> (<t:${endUnix}:R>)`,
		`• **Reminders:** ${reminderStatus}`,
		`• **Auto-Recall:** ${autoRecallText}`,
		`• **Tracked Rooms:** ${roomsText}`,
	];

	return lines.join('\n');
}
