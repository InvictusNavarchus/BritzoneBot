import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cancelBreakoutTimer,
	monitorBreakoutTimer,
} from '@/modules/breakout/services/timer.js';
import {
	getTimerData,
	resetStateForTest,
	setTimerData,
} from '@/modules/breakout/state/state.js';

describe('timer service (cancelBreakoutTimer)', () => {
	let tempDir: string;
	let originalStateDir: string | undefined;
	let originalStateFile: string | undefined;

	beforeEach(async () => {
		originalStateDir = process.env.STATE_DIR;
		originalStateFile = process.env.STATE_FILE;
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'britzone-timer-test-'));
		process.env.STATE_DIR = tempDir;
		process.env.STATE_FILE = path.join(tempDir, 'breakoutState.json');
		resetStateForTest();
	});

	afterEach(async () => {
		resetStateForTest();
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
		if (originalStateDir !== undefined) {
			process.env.STATE_DIR = originalStateDir;
		} else {
			delete process.env.STATE_DIR;
		}
		if (originalStateFile !== undefined) {
			process.env.STATE_FILE = originalStateFile;
		} else {
			delete process.env.STATE_FILE;
		}
	});

	it('returns false when no active timer exists for guild', async () => {
		const result = await cancelBreakoutTimer('guild-no-timer');
		expect(result).toBe(false);
	});

	/**
	 * Builds a client whose single breakout room always rejects sends with the
	 * given API error, so retry behaviour can be counted.
	 */
	function clientRejectingSends(guildId: string, error: Error) {
		const send = vi.fn().mockRejectedValue(error);
		const channel = {
			id: 'r1',
			name: 'breakout-room-1',
			isTextBased: () => true,
			send,
		};
		const guild = {
			id: guildId,
			channels: { cache: new Map([['r1', channel]]) },
		};
		const client = {
			guilds: { cache: new Map([[guildId, guild]]) },
		} as unknown as Client;
		return { client, send };
	}

	it('does not retry reminder sends that fail permanently', async () => {
		const guildId = 'guild-perm-fail';
		const { client, send } = clientRejectingSends(
			guildId,
			Object.assign(new Error('Missing Permissions'), {
				code: 50013,
				status: 403,
			}),
		);

		// 26 minutes into a 30 minute session: both the 15m and 5m reminders were
		// missed, so each takes the catch-up path and attempts exactly one send.
		const timerData = {
			timerId: 't-perm',
			totalMinutes: 30,
			startTime: Date.now() - 26 * 60 * 1000,
			guildId,
			breakoutRooms: ['r1'],
			sentReminders: [],
		};
		await setTimerData(guildId, timerData);

		await monitorBreakoutTimer(timerData, client);
		await cancelBreakoutTimer(guildId);

		// Two catch-up reminders, one attempt each — not maxRetries (5) apiece.
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('retries reminder sends that fail transiently', async () => {
		const guildId = 'guild-transient-fail';
		const { client, send } = clientRejectingSends(
			guildId,
			Object.assign(new Error('Internal Server Error'), { status: 500 }),
		);

		// Only the 5m reminder is missed here, so a single catch-up runs and
		// exhausts the retry budget.
		const timerData = {
			timerId: 't-transient',
			totalMinutes: 30,
			startTime: Date.now() - 26 * 60 * 1000,
			guildId,
			breakoutRooms: ['r1'],
			sentReminders: [15],
		};
		await setTimerData(guildId, timerData);

		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const monitoring = monitorBreakoutTimer(timerData, client);
			await vi.advanceTimersByTimeAsync(60_000);
			await monitoring;
		} finally {
			vi.useRealTimers();
		}
		await cancelBreakoutTimer(guildId);

		expect(send).toHaveBeenCalledTimes(5);
	});

	it('clears persistent timer data and in-memory cleanups when canceled', async () => {
		const guildId = 'guild-timer-1';
		const timerData = {
			timerId: 't-123',
			totalMinutes: 30,
			startTime: Date.now(),
			guildId,
			breakoutRooms: ['r1', 'r2'],
			sentReminders: [],
		};

		await setTimerData(guildId, timerData);
		expect(await getTimerData(guildId)).toEqual(timerData);

		const result = await cancelBreakoutTimer(guildId);
		expect(result).toBe(true);
		expect(await getTimerData(guildId)).toBeNull();
	});
});
