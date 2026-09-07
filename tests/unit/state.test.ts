import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearSession,
	clearTimerData,
	completeOperation,
	flushState,
	getAllGuildStates,
	getCompletedSteps,
	getCurrentOperation,
	getTimerData,
	hasOperationInProgress,
	resetStateForTest,
	setMainRoomId,
	setTimerData,
	startOperation,
	storeRoomIds,
	updateProgress,
} from '@/modules/breakout/state/state.js';

describe('StateManager (state.ts)', () => {
	let tempDir: string;
	let originalStateDir: string | undefined;
	let originalStateFile: string | undefined;

	beforeEach(async () => {
		originalStateDir = process.env.STATE_DIR;
		originalStateFile = process.env.STATE_FILE;
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'britzone-state-test-'));
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

	describe('Operation tracking lifecycle', () => {
		it('startOperation creates a new active operation entry', async () => {
			const guildId = 'guild-123';
			await startOperation(guildId, 'create', { numRooms: 3 });

			const op = await getCurrentOperation(guildId);
			expect(op).toBeDefined();
			expect(op?.type).toBe('create');
			expect(op?.params).toEqual({ numRooms: 3 });
			expect(op?.progress.started).toBe(true);
			expect(op?.progress.completed).toBe(false);
		});

		it('hasOperationInProgress correctly returns active operation status', async () => {
			const guildId = 'guild-123';

			expect(await hasOperationInProgress(guildId)).toBe(false);

			await startOperation(guildId, 'distribute', { mainRoomId: 'main-1' });
			expect(await hasOperationInProgress(guildId)).toBe(true);

			await completeOperation(guildId);
			expect(await hasOperationInProgress(guildId)).toBe(false);
		});

		it('updateProgress marks individual step as completed with metadata', async () => {
			const guildId = 'guild-123';
			await startOperation(guildId, 'create', { numRooms: 2 });

			const updated = await updateProgress(guildId, 'create_room_1', {
				channelId: 'ch-1',
			});
			expect(updated).toBe(true);

			const steps = await getCompletedSteps(guildId);
			expect(steps.create_room_1).toBeDefined();
			expect(steps.create_room_1?.completed).toBe(true);
			expect(steps.create_room_1?.channelId).toBe('ch-1');
		});

		it('updateProgress returns false when no active operation exists', async () => {
			const updated = await updateProgress('non-existent-guild', 'step_1');
			expect(updated).toBe(false);
		});

		it('completeOperation moves active operation to history and clears current', async () => {
			const guildId = 'guild-123';
			await startOperation(guildId, 'recall', {});
			await completeOperation(guildId);

			const op = await getCurrentOperation(guildId);
			expect(op).toBeUndefined();

			// Read file directly to verify history was saved
			const fileContent = await fs.readFile(
				process.env.STATE_FILE as string,
				'utf8',
			);
			const state = JSON.parse(fileContent);
			expect(state[guildId].history).toHaveLength(1);
			expect(state[guildId].history[0].type).toBe('recall');
			expect(state[guildId].history[0].progress.completed).toBe(true);
		});
	});

	describe('Session data management', () => {
		it('storeRoomIds and setMainRoomId persist session information', async () => {
			const guildId = 'guild-123';
			await storeRoomIds(guildId, ['r1', 'r2']);
			await setMainRoomId(guildId, 'main-1');

			const fileContent = await fs.readFile(
				process.env.STATE_FILE as string,
				'utf8',
			);
			const state = JSON.parse(fileContent);
			expect(state[guildId].session.roomIds).toEqual(['r1', 'r2']);
			expect(state[guildId].session.mainRoomId).toBe('main-1');
		});

		it('clearSession removes session object from guild state', async () => {
			const guildId = 'guild-123';
			await storeRoomIds(guildId, ['r1', 'r2']);
			await clearSession(guildId);

			const fileContent = await fs.readFile(
				process.env.STATE_FILE as string,
				'utf8',
			);
			const state = JSON.parse(fileContent);
			expect(state[guildId].session).toBeUndefined();
		});
	});

	describe('Timer data management', () => {
		it('stores, retrieves, and clears timer data correctly', async () => {
			const guildId = 'guild-123';
			const timerData = {
				timerId: 't-1',
				totalMinutes: 10,
				startTime: Date.now(),
				guildId,
				breakoutRooms: ['r1', 'r2'],
				sentReminders: [],
				autoRecall: true,
				gracePeriodSeconds: 60,
				mainRoomId: 'main-1',
			};

			await setTimerData(guildId, timerData);

			const retrieved = await getTimerData(guildId);
			expect(retrieved).toEqual(timerData);
			expect(retrieved?.autoRecall).toBe(true);
			expect(retrieved?.gracePeriodSeconds).toBe(60);
			expect(retrieved?.mainRoomId).toBe('main-1');

			await clearTimerData(guildId);

			const afterClear = await getTimerData(guildId);
			expect(afterClear).toBeNull();
		});
	});

	describe('concurrent initialization', () => {
		it('loads persisted state once when many callers race at boot', async () => {
			await fs.writeFile(
				process.env.STATE_FILE as string,
				JSON.stringify({
					'guild-race': { session: { mainRoomId: 'main-race' } },
				}),
			);
			resetStateForTest();

			// Every exported function awaits initializeState, so a burst of commands
			// arriving together is the normal case.
			const results = await Promise.all([
				getCurrentOperation('guild-race'),
				getTimerData('guild-race'),
				hasOperationInProgress('guild-race'),
				getAllGuildStates(),
			]);

			const allStates = results[3] as Awaited<
				ReturnType<typeof getAllGuildStates>
			>;
			expect(allStates['guild-race']?.session?.mainRoomId).toBe('main-race');
		});

		it('does not let a concurrent load discard a write already made', async () => {
			await fs.writeFile(
				process.env.STATE_FILE as string,
				JSON.stringify({ 'guild-race': { session: { roomIds: ['r1'] } } }),
			);
			resetStateForTest();

			// A write racing a first read must survive: previously the second
			// loadState() replaced inMemoryState wholesale and dropped it.
			await Promise.all([
				setMainRoomId('guild-race', 'main-written'),
				getAllGuildStates(),
				storeRoomIds('guild-race', ['r1', 'r2']),
			]);

			const allStates = await getAllGuildStates();
			expect(allStates['guild-race']?.session?.mainRoomId).toBe('main-written');
			expect(allStates['guild-race']?.session?.roomIds).toEqual(['r1', 'r2']);
		});

		it('retries initialization after a failure instead of caching it', async () => {
			resetStateForTest();
			process.env.STATE_FILE = path.join(tempDir, 'nested', 'state.json');
			process.env.STATE_DIR = path.join(tempDir, 'nested');

			await setMainRoomId('guild-retry', 'main-1');
			const allStates = await getAllGuildStates();
			expect(allStates['guild-retry']?.session?.mainRoomId).toBe('main-1');
		});
	});

	describe('legacy timer state migration', () => {
		it('folds a legacy fiveMinSent flag into sentReminders on load', async () => {
			await fs.writeFile(
				process.env.STATE_FILE as string,
				JSON.stringify({
					'guild-legacy': {
						timerData: {
							timerId: 't-legacy',
							totalMinutes: 30,
							startTime: 1720000000000,
							guildId: 'guild-legacy',
							breakoutRooms: ['r1'],
							sentReminders: [15],
							fiveMinSent: true,
						},
					},
				}),
			);
			resetStateForTest();

			const timerData = await getTimerData('guild-legacy');

			expect(timerData?.sentReminders).toEqual([15, 5]);
			expect(timerData).not.toHaveProperty('fiveMinSent');
		});

		it('leaves sentReminders untouched when the legacy flag was never set', async () => {
			await fs.writeFile(
				process.env.STATE_FILE as string,
				JSON.stringify({
					'guild-legacy': {
						timerData: {
							totalMinutes: 45,
							startTime: 1720000000000,
							guildId: 'guild-legacy',
							breakoutRooms: ['r1'],
							sentReminders: [22],
							fiveMinSent: false,
						},
					},
				}),
			);
			resetStateForTest();

			const timerData = await getTimerData('guild-legacy');

			expect(timerData?.sentReminders).toEqual([22]);
			expect(timerData).not.toHaveProperty('fiveMinSent');
		});

		it('defaults sentReminders when a legacy record omitted it entirely', async () => {
			await fs.writeFile(
				process.env.STATE_FILE as string,
				JSON.stringify({
					'guild-legacy': {
						timerData: {
							totalMinutes: 30,
							startTime: 1720000000000,
							guildId: 'guild-legacy',
							breakoutRooms: ['r1'],
							fiveMinSent: true,
						},
					},
				}),
			);
			resetStateForTest();

			const timerData = await getTimerData('guild-legacy');

			expect(timerData?.sentReminders).toEqual([5]);
		});
	});

	describe('State retrieval and flushing', () => {
		it('getAllGuildStates returns all in-memory guild states', async () => {
			await setTimerData('guild-1', {
				totalMinutes: 5,
				startTime: Date.now(),
				guildId: 'guild-1',
				breakoutRooms: ['r1'],
				sentReminders: [],
			});
			await setMainRoomId('guild-2', 'main-2');

			const allStates = await getAllGuildStates();
			expect(allStates['guild-1']?.timerData).toBeDefined();
			expect(allStates['guild-2']?.session?.mainRoomId).toBe('main-2');
		});

		it('flushState completes without errors', async () => {
			await setTimerData('guild-1', {
				totalMinutes: 10,
				startTime: Date.now(),
				guildId: 'guild-1',
				breakoutRooms: ['r1'],
				sentReminders: [],
			});
			await expect(flushState()).resolves.toBeUndefined();
		});
	});
});
