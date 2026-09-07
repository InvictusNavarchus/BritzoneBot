import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelBreakoutTimer } from '@/modules/breakout/services/timer.js';
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
