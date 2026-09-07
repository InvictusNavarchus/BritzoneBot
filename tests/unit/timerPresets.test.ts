import { describe, expect, it } from 'vitest';
import {
	FGD_TIMER_PRESETS,
	formatDuration,
	formatReminderMessage,
	formatScheduleSummary,
	formatTimerStatus,
	getPresetDurations,
	getTimerSchedule,
	isPresetDuration,
	MIN_CUSTOM_TIMER_MINUTES,
	TIMER_PRESET_CHOICES,
} from '@/modules/breakout/constants/timerPresets.js';
import type { TimerData } from '@/modules/breakout/state/state.js';

describe('timerPresets', () => {
	describe('FGD_TIMER_PRESETS lookup table', () => {
		it('contains defined reminder thresholds for 0.05 (3s), 20, 30, 45, 60, and 90 minute presets', () => {
			expect(FGD_TIMER_PRESETS[0.05]).toEqual([0.03, 0.015]);
			expect(FGD_TIMER_PRESETS[20]).toEqual([10, 5]);
			expect(FGD_TIMER_PRESETS[30]).toEqual([15, 5]);
			expect(FGD_TIMER_PRESETS[45]).toEqual([22, 10, 3]);
			expect(FGD_TIMER_PRESETS[60]).toEqual([30, 15, 5]);
			expect(FGD_TIMER_PRESETS[90]).toEqual([45, 20, 5]);
		});
	});

	describe('preset choices and validation', () => {
		it('lists preset durations in ascending order, sub-minute preset first', () => {
			expect(getPresetDurations()).toEqual([0.05, 20, 30, 45, 60, 90]);
		});

		it('accepts every preset duration regardless of the custom-duration floor', () => {
			for (const minutes of getPresetDurations()) {
				expect(isPresetDuration(minutes)).toBe(true);
			}
			// The 20m and 3s presets sit below the custom floor and must still pass.
			expect(isPresetDuration(20)).toBe(true);
			expect(20).toBeLessThan(MIN_CUSTOM_TIMER_MINUTES);
			expect(isPresetDuration(0.05)).toBe(true);
		});

		it('rejects non-preset durations', () => {
			expect(isPresetDuration(35)).toBe(false);
			expect(isPresetDuration(25)).toBe(false);
			expect(isPresetDuration(1)).toBe(false);
		});

		it('derives a slash-command choice for every preset, so the two cannot drift', () => {
			expect(TIMER_PRESET_CHOICES).toHaveLength(
				Object.keys(FGD_TIMER_PRESETS).length,
			);

			for (const choice of TIMER_PRESET_CHOICES) {
				// Every advertised choice must survive the handler's own guard.
				expect(isPresetDuration(Number.parseFloat(choice.value))).toBe(true);
			}
		});

		it('labels presets from their reminder schedule, with an override for the test preset', () => {
			const byValue = new Map(
				TIMER_PRESET_CHOICES.map((c) => [c.value, c.name]),
			);
			expect(byValue.get('0.05')).toBe('3 seconds (Testing)');
			expect(byValue.get('20')).toBe('20 minutes (Reminders at 10m, 5m)');
			expect(byValue.get('45')).toBe('45 minutes (Reminders at 22m, 10m, 3m)');
			expect(byValue.get('90')).toBe('90 minutes (Reminders at 45m, 20m, 5m)');
		});
	});

	describe('formatReminderMessage', () => {
		it('generates concise reminder messages for participants', () => {
			expect(formatReminderMessage(15)).toBe(
				'⏱️ **15 minutes remaining** in this breakout session.',
			);
			expect(formatReminderMessage(1)).toBe(
				'⏱️ **1 minute remaining** in this breakout session.',
			);
		});

		it('renders sub-minute thresholds in seconds rather than fractional minutes', () => {
			// The 3s testing preset schedules 0.03 and 0.015 minute thresholds.
			expect(formatReminderMessage(0.03)).toBe(
				'⏱️ **1.8 seconds remaining** in this breakout session.',
			);
			expect(formatReminderMessage(0.015)).toBe(
				'⏱️ **0.9 seconds remaining** in this breakout session.',
			);
		});
	});

	describe('formatDuration', () => {
		it('pluralises minutes and switches to seconds below one minute', () => {
			expect(formatDuration(45)).toBe('45 minutes');
			expect(formatDuration(1)).toBe('1 minute');
			expect(formatDuration(0.05)).toBe('3 seconds');
			expect(formatDuration(1 / 60)).toBe('1 second');
		});
	});

	describe('getTimerSchedule', () => {
		it('returns exact preset schedule when totalMinutes matches preset', () => {
			const schedule45 = getTimerSchedule(45);
			expect(schedule45).toEqual(FGD_TIMER_PRESETS[45]);
		});

		it('calculates custom thresholds [min(30, 2/3 D), 10, 5] for durations >= 30m', () => {
			// For a custom 35 minute session: 23m (2/3 of 35), 10m, 5m
			const schedule35 = getTimerSchedule(35);
			expect(schedule35).toEqual([23, 10, 5]);

			// For a custom 40 minute session: 27m (2/3 of 40), 10m, 5m
			const schedule40 = getTimerSchedule(40);
			expect(schedule40).toEqual([27, 10, 5]);

			// For a custom 50 minute session: min(30, 33) = 30m, 10m, 5m
			const schedule50 = getTimerSchedule(50);
			expect(schedule50).toEqual([30, 10, 5]);

			// For a custom 75 minute session: min(30, 50) = 30m, 10m, 5m
			const schedule75 = getTimerSchedule(75);
			expect(schedule75).toEqual([30, 10, 5]);
		});

		it('returns empty schedule for non-preset durations under 30 minutes', () => {
			expect(getTimerSchedule(25)).toEqual([]);
			expect(getTimerSchedule(15)).toEqual([]);
			expect(getTimerSchedule(10)).toEqual([]);
			expect(getTimerSchedule(1)).toEqual([]);
		});
	});

	describe('formatScheduleSummary', () => {
		it('formats reminder schedule summary correctly', () => {
			const schedule = getTimerSchedule(45);
			const summary = formatScheduleSummary(schedule);
			expect(summary).toBe('Reminders scheduled at 22m, 10m, 3m remaining.');
		});

		it('summarises sub-minute schedules in seconds', () => {
			expect(formatScheduleSummary(getTimerSchedule(0.05))).toBe(
				'Reminders scheduled at 1.8s, 0.9s remaining.',
			);
		});

		it('handles empty schedules gracefully', () => {
			expect(formatScheduleSummary([])).toBe(
				'No intermediate reminders scheduled.',
			);
		});
	});

	describe('formatTimerStatus', () => {
		const baseStartTime = 1720000000000;

		it('formats active running timer status with reminders, auto-recall, and rooms', () => {
			const timerData: TimerData = {
				guildId: 'guild-1',
				startTime: baseStartTime,
				totalMinutes: 45,
				breakoutRooms: ['room-1', 'room-2'],
				sentReminders: [22],
				autoRecall: true,
				mainRoomId: 'main-room-1',
				gracePeriodSeconds: 60,
			};

			const now = baseStartTime + 25 * 60 * 1000; // 25 min in
			const result = formatTimerStatus(timerData, now);

			expect(result).toContain('⏱️ **Breakout Timer Status**');
			expect(result).toContain('• **Status:** 🟢 Active');
			expect(result).toContain('• **Duration:** 45 minutes');
			expect(result).toContain('• **Started:** <t:1720000000:T>');
			expect(result).toContain('• **Target End Time:** <t:1720002700:T>');
			expect(result).toContain('✅ 22m (sent)');
			expect(result).toContain('⏳ 10m (pending)');
			expect(result).toContain('⏳ 3m (pending)');
			expect(result).toContain(
				'• **Auto-Recall:** Enabled (<#main-room-1> with 60s grace period)',
			);
			expect(result).toContain(
				'• **Tracked Rooms:** <#room-1> <#room-2> (2 rooms)',
			);
		});

		it('formats status during grace period', () => {
			const timerData: TimerData = {
				guildId: 'guild-1',
				startTime: baseStartTime,
				totalMinutes: 30,
				breakoutRooms: ['room-1'],
				sentReminders: [15, 5],
				autoRecall: true,
				mainRoomId: 'main-room-1',
				gracePeriodSeconds: 60,
			};

			const now = baseStartTime + 30 * 60 * 1000 + 10 * 1000; // 10s into grace period
			const result = formatTimerStatus(timerData, now);

			expect(result).toContain('⏳ Grace Period');
			expect(result).toContain('• **Duration:** 30 minutes');
		});

		it('formats expired timer status', () => {
			const timerData: TimerData = {
				guildId: 'guild-1',
				startTime: baseStartTime,
				totalMinutes: 30,
				breakoutRooms: ['room-1'],
				sentReminders: [],
				autoRecall: true,
				gracePeriodSeconds: 60,
			};

			const now = baseStartTime + 35 * 60 * 1000; // past recall time
			const result = formatTimerStatus(timerData, now);

			expect(result).toContain('🏁 Expired / Session Ended');
		});

		it('formats sub-minute (3s) duration properly', () => {
			const timerData: TimerData = {
				guildId: 'guild-1',
				startTime: baseStartTime,
				totalMinutes: 0.05,
				breakoutRooms: [],
				sentReminders: [],
				autoRecall: false,
			};

			const result = formatTimerStatus(timerData, baseStartTime);

			expect(result).toContain('• **Duration:** 3 seconds');
			expect(result).toContain('• **Auto-Recall:** Disabled');
			expect(result).toContain('• **Tracked Rooms:** None');
		});

		it('formats awaiting manual recall when autoRecall is false and now >= endTime', () => {
			const timerData: TimerData = {
				guildId: 'guild-1',
				startTime: baseStartTime,
				totalMinutes: 30,
				breakoutRooms: ['room-1'],
				sentReminders: [15, 5],
				autoRecall: false,
			};

			// Exactly at endTime
			const atEndResult = formatTimerStatus(
				timerData,
				baseStartTime + 30 * 60 * 1000,
			);
			expect(atEndResult).toContain(
				"• **Status:** 🏁 Time's up (awaiting manual recall)",
			);

			// Well after endTime
			const afterEndResult = formatTimerStatus(
				timerData,
				baseStartTime + 45 * 60 * 1000,
			);
			expect(afterEndResult).toContain(
				"• **Status:** 🏁 Time's up (awaiting manual recall)",
			);
		});

		it('reports reminder status strictly based on recorded sent state', () => {
			const timerData: TimerData = {
				guildId: 'guild-1',
				startTime: baseStartTime,
				totalMinutes: 45,
				breakoutRooms: ['room-1'],
				sentReminders: [22], // only 22m recorded as sent
				autoRecall: true,
			};

			// Even if time has passed the 10m mark, 10m and 3m remain pending if not in sentReminders
			const now = baseStartTime + 40 * 60 * 1000;
			const result = formatTimerStatus(timerData, now);

			expect(result).toContain('✅ 22m (sent)');
			expect(result).toContain('⏳ 10m (pending)');
			expect(result).toContain('⏳ 3m (pending)');
		});
	});
});
