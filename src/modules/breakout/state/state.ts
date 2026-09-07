import fs from 'node:fs/promises';
import path from 'node:path';
import {
	ChannelType,
	type Guild,
	type VoiceBasedChannel,
	type VoiceChannel,
} from 'discord.js';
import { logger } from '@/lib/logger.js';

export type BreakoutSubcommand =
	| 'create'
	| 'distribute'
	| 'recall'
	| 'delete'
	| 'timer'
	| 'timer-cancel'
	| 'broadcast'
	| 'send-message'
	| 'status';

/**
 * Single operation step data
 */
interface OperationStep {
	completed: boolean;
	timestamp: number;
	[key: string]: unknown;
}

/**
 * Operation progress tracking
 */
interface OperationProgress {
	started: boolean;
	completed: boolean;
	steps: Record<string, OperationStep>;
	startTime: number;
	completedTime?: number;
	/**
	 * Number of steps the operation recorded, kept when the step map itself is
	 * dropped on archival so history still says how much work was done.
	 */
	stepCount?: number;
}

/**
 * Current operation details
 */
export interface CurrentOperation {
	type: BreakoutSubcommand | string;
	params: Record<string, unknown>;
	progress: OperationProgress;
}

/**
 * Persisted room/session data structure
 */
interface PersistedSession {
	mainRoomId?: string;
	roomIds?: string[];
}

/**
 * Timer data for breakout sessions
 */
export interface TimerData {
	timerId?: string;
	totalMinutes: number;
	startTime: number;
	guildId: string;
	breakoutRooms: string[];
	sentReminders: number[];
	autoRecall?: boolean;
	gracePeriodSeconds?: number;
	mainRoomId?: string;
	/**
	 * @deprecated Superseded by {@link TimerData.sentReminders}, which tracks
	 * every threshold rather than just the 5-minute one. Retained so state files
	 * written before the migration still parse; {@link loadState} folds it into
	 * `sentReminders` and drops it, so nothing downstream reads it.
	 */
	fiveMinSent?: boolean;
}

/**
 * Folds the legacy `fiveMinSent` flag into `sentReminders`.
 *
 * The two fields tracked the same fact and were reconciled ad hoc at every read
 * site. Migrating once, where persisted state enters the process, leaves a
 * single source of truth for the rest of the codebase.
 */
function migrateTimerData(timerData: TimerData): void {
	const sent = new Set<number>(timerData.sentReminders ?? []);
	if (timerData.fiveMinSent) {
		sent.add(5);
	}
	timerData.sentReminders = Array.from(sent);
	delete timerData.fiveMinSent;
}

/**
 * Guild state data structure on disk
 */
export interface GuildState {
	currentOperation?: CurrentOperation;
	history?: CurrentOperation[];
	session?: PersistedSession;
	timerData?: TimerData;
}

function getStatePath(): string {
	return process.env.STATE_DIR || path.join(process.cwd(), 'data');
}

function getStateFile(): string {
	return (
		process.env.STATE_FILE || path.join(getStatePath(), 'breakoutState.json')
	);
}

const MAX_HISTORY = 20;
let inMemoryState: Record<string, GuildState> = {};
let initialized: boolean = false;
let initPromise: Promise<void> | null = null;
let saveQueue: Promise<void> = Promise.resolve();

/**
 * Resets the in-memory state and initialized flag for testing
 */
export function resetStateForTest(): void {
	inMemoryState = {};
	initialized = false;
	initPromise = null;
	saveQueue = Promise.resolve();
}

/**
 * Initialize the state manager, ensuring the data directory exists
 * and loading any existing state.
 *
 * Nearly every exported function awaits this, so concurrent callers are the
 * normal case rather than the exception. The in-flight promise is memoised
 * because `initialized` is only set once `loadState()` has resolved: without it,
 * two commands arriving together both ran `loadState()`, and the second
 * `inMemoryState = JSON.parse(data)` replaced the object graph the first had
 * already begun writing into, silently discarding its mutations.
 *
 * The memo is cleared on failure so a transient filesystem error can be retried
 * by the next caller rather than poisoning the process.
 */
export async function initializeState(): Promise<void> {
	if (initialized) return;

	if (!initPromise) {
		initPromise = (async () => {
			try {
				await fs.mkdir(getStatePath(), { recursive: true });
				await loadState();
				initialized = true;
				logger.info('📂 StateManager initialized');
			} catch (error) {
				logger.error({ err: error }, '❌ Failed to initialize StateManager');
			} finally {
				initPromise = null;
			}
		})();
	}

	return initPromise;
}

/**
 * Gets or creates the GuildState entry for a guild
 */
function getGuildState(guildId: string): GuildState {
	if (!inMemoryState[guildId]) {
		inMemoryState[guildId] = {};
	}
	return inMemoryState[guildId];
}

/**
 * Load state from disk
 */
async function loadState(): Promise<void> {
	try {
		const data = await fs.readFile(getStateFile(), 'utf8');
		inMemoryState = JSON.parse(data);
		for (const guildState of Object.values(inMemoryState)) {
			if (guildState.timerData) {
				migrateTimerData(guildState.timerData);
			}
		}
		logger.debug('📤 Loaded breakout state data');
	} catch (error: unknown) {
		const err = error as { code?: string };
		if (err.code === 'ENOENT') {
			inMemoryState = {};
			logger.info('🆕 Created new breakout state data');
		} else {
			logger.error({ err: error }, '❌ Error loading breakout state');
			throw error;
		}
	}
}

/**
 * Window over which rapid progress updates are coalesced into one disk write.
 *
 * Short enough that a crash loses at most a fraction of a second of
 * checkpoints, and every checkpoint it could lose guards work that is safe to
 * repeat on resume.
 */
const SAVE_DEBOUNCE_MS = 250;
let pendingSaveTimer: NodeJS.Timeout | null = null;

async function saveState(): Promise<void> {
	if (pendingSaveTimer) {
		clearTimeout(pendingSaveTimer);
		pendingSaveTimer = null;
	}

	const nextSave = saveQueue.then(async () => {
		try {
			await initializeState();
			const targetFile = getStateFile();
			const tempFile = `${targetFile}.tmp`;
			await fs.writeFile(tempFile, JSON.stringify(inMemoryState, null, 2));
			await fs.rename(tempFile, targetFile);
			logger.trace('💾 Saved breakout state data');
		} catch (error) {
			logger.error({ err: error }, '❌ Error saving breakout state');
		}
	});

	saveQueue = nextSave.catch((err) => {
		logger.error({ err }, '❌ Save queue encountered an unhandled rejection');
	});
	return nextSave;
}

/**
 * Requests a save without waiting for it, coalescing bursts.
 *
 * Used for progress checkpoints, which arrive once per member moved: a
 * 100-person distribution otherwise serialised and rewrote the entire state
 * file a hundred times.
 */
function scheduleSave(): void {
	if (pendingSaveTimer) return;

	pendingSaveTimer = setTimeout(() => {
		pendingSaveTimer = null;
		void saveState();
	}, SAVE_DEBOUNCE_MS);

	// Never hold the process open for a pending checkpoint; graceful shutdown
	// calls flushState, which writes synchronously with respect to the caller.
	pendingSaveTimer.unref?.();
}

/**
 * Start tracking a new operation
 */
export async function startOperation(
	guildId: string,
	operationType: BreakoutSubcommand | string,
	params: Record<string, unknown>,
): Promise<void> {
	await initializeState();
	const guildState = getGuildState(guildId);
	guildState.currentOperation = {
		type: operationType,
		params,
		progress: {
			started: true,
			completed: false,
			steps: {},
			startTime: Date.now(),
		},
	};
	logger.info(
		{ guildId, operationType },
		'🚀 Started tracking new breakout operation',
	);
	await saveState();
}

export interface UpdateProgressOptions {
	/**
	 * Write to disk before resolving instead of coalescing with nearby updates.
	 *
	 * Set this for checkpoints guarding work that is *not* safe to repeat — room
	 * creation, for instance, where losing the checkpoint means resume creates a
	 * duplicate channel. Moves and deletes are idempotent enough to ride the
	 * debounce.
	 */
	immediate?: boolean;
}

/**
 * Update progress for a step
 */
export async function updateProgress(
	guildId: string,
	step: string,
	data: Record<string, unknown> = {},
	options: UpdateProgressOptions = {},
): Promise<boolean> {
	await initializeState();
	const guildState = inMemoryState[guildId];

	if (!guildState?.currentOperation) {
		logger.warn(
			{ guildId, step },
			'⚠️ Cannot update progress: No active operation',
		);
		return false;
	}

	guildState.currentOperation.progress.steps[step] = {
		completed: true,
		timestamp: Date.now(),
		...data,
	};
	logger.debug({ guildId, step }, '🔄 Updated operation progress');

	if (options.immediate) {
		await saveState();
	} else {
		scheduleSave();
	}
	return true;
}

/**
 * Complete an operation
 */
export async function completeOperation(guildId: string): Promise<void> {
	await initializeState();
	const guildState = inMemoryState[guildId];

	if (!guildState?.currentOperation) return;

	const operation = guildState.currentOperation;
	operation.progress.completed = true;
	operation.progress.completedTime = Date.now();

	if (!guildState.history) {
		guildState.history = [];
	}

	// Archive without the step map. Steps are resume checkpoints — one entry per
	// room created, per member moved — so a single distribution can record
	// hundreds. They are meaningless once the operation is complete, but
	// MAX_HISTORY kept twenty such maps alive, growing the state file (rewritten
	// in full on every save) without bound.
	const stepCount = Object.keys(operation.progress.steps).length;
	guildState.history.push({
		...operation,
		progress: { ...operation.progress, steps: {}, stepCount },
	});
	guildState.history = guildState.history.slice(-MAX_HISTORY);
	delete guildState.currentOperation;

	logger.info({ guildId, stepCount }, '✅ Completed breakout operation');
	await saveState();
}

/**
 * How long an operation may sit without recording a step before it is treated
 * as abandoned.
 *
 * Comfortably above the 120s handler timeout that bounds the longest real
 * operation, so a slow-but-live run is never mistaken for a wedged one.
 */
export const OPERATION_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * Returns whether an operation has gone quiet long enough to be abandoned.
 *
 * Measured from the most recent checkpoint rather than the start time, so a
 * long operation that is still making progress stays live.
 */
export function isOperationStale(
	operation: CurrentOperation,
	now: number = Date.now(),
): boolean {
	const stepTimes = Object.values(operation.progress.steps).map(
		(step) => step.timestamp,
	);
	const lastActivity = Math.max(operation.progress.startTime, ...stepTimes);
	return now - lastActivity > OPERATION_STALE_AFTER_MS;
}

/**
 * Discards the current operation without archiving it to history.
 *
 * This is the recovery path for an operation that was interrupted and will
 * never complete; a completed operation should go through
 * {@link completeOperation} instead.
 *
 * @returns The discarded operation, or undefined if there was none.
 */
export async function clearCurrentOperation(
	guildId: string,
): Promise<CurrentOperation | undefined> {
	await initializeState();
	const guildState = inMemoryState[guildId];
	const cleared = guildState?.currentOperation;

	if (!cleared) return undefined;

	delete guildState.currentOperation;
	logger.info(
		{ guildId, operationType: cleared.type },
		'🧹 Discarded interrupted breakout operation',
	);
	await saveState();
	return cleared;
}

/**
 * Check if operation is in progress
 */
export async function hasOperationInProgress(
	guildId: string,
): Promise<boolean> {
	await initializeState();
	const guildState = inMemoryState[guildId];

	return (
		Boolean(guildState?.currentOperation) &&
		!guildState?.currentOperation?.progress?.completed
	);
}

/**
 * Get current operation
 */
export async function getCurrentOperation(
	guildId: string,
): Promise<CurrentOperation | undefined> {
	await initializeState();
	const guildState = inMemoryState[guildId];
	return guildState?.currentOperation;
}

/**
 * Get completed steps for current operation
 */
export async function getCompletedSteps(
	guildId: string,
): Promise<Record<string, OperationStep>> {
	await initializeState();
	const guildState = inMemoryState[guildId];

	if (!guildState?.currentOperation) return {};
	return { ...guildState.currentOperation.progress.steps };
}

/**
 * Stores breakout room IDs for a guild on disk
 */
export async function storeRoomIds(
	guildId: string,
	roomIds: string[],
): Promise<void> {
	await initializeState();
	const guildState = getGuildState(guildId);
	guildState.session = {
		...guildState.session,
		roomIds,
	};
	logger.debug(
		{ guildId, count: roomIds.length },
		'📝 Stored breakout room IDs',
	);
	await saveState();
}

/**
 * Sets the main room ID for a guild's breakout session on disk
 */
export async function setMainRoomId(
	guildId: string,
	mainRoomId: string,
): Promise<void> {
	await initializeState();
	const guildState = getGuildState(guildId);
	guildState.session = {
		...guildState.session,
		mainRoomId,
	};
	logger.debug(
		{ guildId, mainRoomId },
		'📝 Set main room ID for breakout session',
	);
	await saveState();
}

/**
 * Gets the breakout rooms for a guild resolved from Discord client cache
 */
export function getRooms(guild: Guild): VoiceChannel[] {
	if (!initialized) {
		logger.warn('getRooms called before initializeState');
	}
	const guildState = inMemoryState[guild.id];
	const roomIds = guildState?.session?.roomIds || [];

	if (roomIds.length === 0) {
		return Array.from(
			guild.channels.cache
				.filter(
					(channel): channel is VoiceChannel =>
						channel.type === ChannelType.GuildVoice &&
						channel.name.startsWith('breakout-room-'),
				)
				.values(),
		);
	}

	return roomIds
		.map((id) => guild.channels.cache.get(id))
		.filter(
			(channel): channel is VoiceChannel =>
				channel !== undefined && channel.type === ChannelType.GuildVoice,
		);
}

/**
 * Gets the main room for a guild resolved from Discord client cache
 */
export function getMainRoom(guild: Guild): VoiceBasedChannel | undefined {
	if (!initialized) {
		logger.warn('getMainRoom called before initializeState');
	}
	const guildState = inMemoryState[guild.id];
	const mainRoomId = guildState?.session?.mainRoomId;
	if (!mainRoomId) return undefined;

	const ch = guild.channels.cache.get(mainRoomId);
	if (ch?.isVoiceBased()) {
		return ch as VoiceBasedChannel;
	}
	return undefined;
}

/**
 * Clears session data for a guild from disk
 */
export async function clearSession(guildId: string): Promise<void> {
	await initializeState();
	const guildState = getGuildState(guildId);
	delete guildState.session;
	logger.debug({ guildId }, '🧹 Cleared breakout session');
	await saveState();
}

/**
 * Sets timer data for a guild
 */
export async function setTimerData(
	guildId: string,
	timerData: TimerData,
): Promise<void> {
	await initializeState();
	const guildState = getGuildState(guildId);
	guildState.timerData = timerData;
	logger.debug({ guildId }, '💾 Storing timer data');
	await saveState();
}

/**
 * Safely marks a reminder threshold as sent in the timer state, ensuring
 * that the timerId has not changed (fenced state update).
 */
export async function markReminderSent(
	guildId: string,
	timerId: string,
	remainingMinutes: number,
): Promise<boolean> {
	await initializeState();
	const guildState = getGuildState(guildId);
	const currentTimer = guildState.timerData;

	if (
		!currentTimer ||
		(currentTimer.timerId && currentTimer.timerId !== timerId)
	) {
		logger.warn(
			{ guildId, timerId, currentTimerId: currentTimer?.timerId },
			'⚠️ Timer state modified or cleared; skipping reminder state write',
		);
		return false;
	}

	currentTimer.sentReminders = Array.from(
		new Set([...(currentTimer.sentReminders ?? []), remainingMinutes]),
	);
	await saveState();
	return true;
}

/**
 * Gets timer data for a guild
 */
export async function getTimerData(guildId: string): Promise<TimerData | null> {
	await initializeState();
	const guildState = inMemoryState[guildId];
	return guildState?.timerData || null;
}

/**
 * Clears timer data for a guild
 */
export async function clearTimerData(guildId: string): Promise<void> {
	await initializeState();
	const guildState = getGuildState(guildId);
	delete guildState.timerData;
	logger.debug({ guildId }, '🗑️ Clearing timer data');
	await saveState();
}

/**
 * Gets a shallow copy of all guild states in memory
 */
export async function getAllGuildStates(): Promise<Record<string, GuildState>> {
	await initializeState();
	return { ...inMemoryState };
}

/**
 * Ensures all pending state save operations are flushed to disk
 */
export async function flushState(): Promise<void> {
	// Force any debounced checkpoint out before draining the queue, otherwise a
	// shutdown could drop the last few progress updates.
	if (pendingSaveTimer) {
		await saveState();
	}
	await saveQueue;
}
