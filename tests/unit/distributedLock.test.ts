import os from 'node:os';
import {
	ChannelType,
	type Client,
	Collection,
	type Guild,
	type Message,
	PermissionFlagsBits,
	type TextChannel,
} from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as distributedLock from '@/lib/distributedLock.js';
import * as guildConfig from '@/lib/guildConfig.js';
import { logger } from '@/lib/logger.js';

describe('Distributed Instance Lock (distributedLock.ts)', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(async () => {
		await distributedLock.releaseDistributedLock();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	describe('getDeveloperIdentity', () => {
		it('returns developer identity with DEV_NAME if set', () => {
			const originalEnv = process.env.DEV_NAME;
			process.env.DEV_NAME = 'alice';
			const id = distributedLock.getDeveloperIdentity();
			expect(id).toBe(`alice@${os.hostname()}`);
			if (originalEnv) {
				process.env.DEV_NAME = originalEnv;
			} else {
				delete process.env.DEV_NAME;
			}
		});

		it('falls back to userInfo or developer if DEV_NAME is not set', () => {
			const originalEnv = process.env.DEV_NAME;
			delete process.env.DEV_NAME;
			const id = distributedLock.getDeveloperIdentity();
			expect(id).toContain(`@${os.hostname()}`);
			if (originalEnv) {
				process.env.DEV_NAME = originalEnv;
			}
		});
	});

	describe('getOrCreateLockChannel', () => {
		it('returns existing lock channel if present', async () => {
			const existingChannel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
			} as unknown as TextChannel;

			const fakeGuild = {
				name: 'Test Guild',
				channels: {
					fetch: vi
						.fn()
						.mockResolvedValue(new Collection([['ch-1', existingChannel]])),
				},
			} as unknown as Guild;

			const result = await distributedLock.getOrCreateLockChannel(fakeGuild);
			expect(result).toBe(existingChannel);
		});

		it('returns null and logs warning if bot lacks ManageChannels permission', async () => {
			const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
			const fakeGuild = {
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection()),
				},
				members: {
					me: {
						permissions: {
							has: vi.fn().mockReturnValue(false),
						},
					},
				},
			} as unknown as Guild;

			const result = await distributedLock.getOrCreateLockChannel(fakeGuild);
			expect(result).toBeNull();
			expect(warnSpy).toHaveBeenCalledWith(
				expect.objectContaining({ guild: 'Test Guild' }),
				expect.stringContaining('Manage Channels'),
			);
		});

		it('auto-creates private lock channel if missing and bot has permission', async () => {
			const newChannel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
			} as unknown as TextChannel;

			const createMock = vi.fn().mockResolvedValue(newChannel);

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				roles: {
					everyone: { id: 'guild-1' },
				},
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection()),
					create: createMock,
				},
				members: {
					me: {
						id: 'bot-1',
						permissions: {
							has: vi.fn().mockReturnValue(true),
						},
					},
				},
			} as unknown as Guild;

			const result = await distributedLock.getOrCreateLockChannel(fakeGuild);
			expect(result).toBe(newChannel);
			expect(createMock).toHaveBeenCalledWith(
				expect.objectContaining({
					name: distributedLock.LOCK_CHANNEL_NAME,
					type: ChannelType.GuildText,
					permissionOverwrites: expect.arrayContaining([
						expect.objectContaining({
							id: 'guild-1',
							deny: [PermissionFlagsBits.ViewChannel],
						}),
						expect.objectContaining({
							id: 'bot-1',
							allow: [
								PermissionFlagsBits.ViewChannel,
								PermissionFlagsBits.SendMessages,
								PermissionFlagsBits.ReadMessageHistory,
								PermissionFlagsBits.ManageMessages,
							],
						}),
					]),
				}),
			);
		});

		it('returns null and logs error if channel creation fails', async () => {
			const errorSpy = vi
				.spyOn(logger, 'error')
				.mockImplementation(() => logger);
			const fakeGuild = {
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockRejectedValue(new Error('Network error')),
				},
			} as unknown as Guild;

			const result = await distributedLock.getOrCreateLockChannel(fakeGuild);
			expect(result).toBeNull();
			expect(errorSpy).toHaveBeenCalled();
		});
	});

	describe('acquireDistributedLock & releaseDistributedLock', () => {
		it('warns and returns if no guild is configured or cached', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({});
			const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

			const client = {
				guilds: {
					cache: new Collection(),
				},
			} as unknown as Client;

			await distributedLock.acquireDistributedLock(client, 0);
			expect(warnSpy).toHaveBeenCalledWith(
				'⚠️ No guilds available to bind distributed lock. Skipping.',
			);
		});

		it('is inert in production and never touches Discord', async () => {
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'production';

			const loadConfigSpy = vi.spyOn(guildConfig, 'loadGuildConfig');
			const client = {
				guilds: {
					cache: new Collection(),
					fetch: vi.fn(),
				},
			} as unknown as Client;

			try {
				await distributedLock.acquireDistributedLock(client, 0);
			} finally {
				if (originalEnv === undefined) {
					delete process.env.NODE_ENV;
				} else {
					process.env.NODE_ENV = originalEnv;
				}
			}

			expect(loadConfigSpy).not.toHaveBeenCalled();
			expect(client.guilds.fetch).not.toHaveBeenCalled();
		});

		it('acquires lock when no active lock message exists', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const sendMock = vi.fn().mockResolvedValue({ id: 'msg-lock-1' });
			const fetchMessagesMock = vi.fn().mockResolvedValue(new Collection());

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: fetchMessagesMock,
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
			} as unknown as Client;

			await distributedLock.acquireDistributedLock(client, 0);

			expect(sendMock).toHaveBeenCalledWith(
				expect.stringContaining('🔒 [INSTANCE_LOCK]'),
			);
		});

		it('cleans up stale lock message and acquires lock', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const staleDeleteMock = vi.fn().mockResolvedValue(undefined);
			const staleMessage = {
				content: `🔒 [INSTANCE_LOCK] ${JSON.stringify({
					instanceId: 'other-uuid',
					developer: 'bob@otherhost',
					hostname: 'otherhost',
					pid: 9999,
					timestamp: Date.now() - 30_000, // 30s ago (> 25s TTL)
				})}`,
				delete: staleDeleteMock,
			} as unknown as Message;

			const sendMock = vi.fn().mockResolvedValue({ id: 'msg-lock-new' });
			const fetchMessagesMock = vi
				.fn()
				.mockResolvedValue(new Collection([['msg-stale', staleMessage]]));

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: fetchMessagesMock,
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
			} as unknown as Client;

			await distributedLock.acquireDistributedLock(client, 0);

			expect(staleDeleteMock).toHaveBeenCalled();
			expect(sendMock).toHaveBeenCalledWith(
				expect.stringContaining('🔒 [INSTANCE_LOCK]'),
			);
		});

		it('exits with code 1, destroys client, and halts without sending on local collision', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const fatalSpy = vi
				.spyOn(logger, 'fatal')
				.mockImplementation(() => logger);
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
				throw new Error('PROCESS_EXIT_1');
			});

			const destroyMock = vi.fn().mockResolvedValue(undefined);
			const sendMock = vi.fn();

			const activeMessage = {
				content: `🔒 [INSTANCE_LOCK] ${JSON.stringify({
					instanceId: 'different-uuid',
					developer: `local-user@${os.hostname()}`,
					hostname: os.hostname(),
					pid: 4321,
					timestamp: Date.now() - 5_000, // 5s ago (< 25s TTL)
				})}`,
				delete: vi.fn(),
			} as unknown as Message;

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: vi
						.fn()
						.mockResolvedValue(new Collection([['msg-1', activeMessage]])),
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
				destroy: destroyMock,
			} as unknown as Client;

			await expect(
				distributedLock.acquireDistributedLock(client, 0),
			).rejects.toThrow('PROCESS_EXIT_1');

			expect(fatalSpy).toHaveBeenCalledWith(
				expect.objectContaining({ pid: 4321 }),
				expect.stringContaining(
					'Another bot instance is already running on this machine',
				),
			);
			expect(destroyMock).toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(sendMock).not.toHaveBeenCalled();
		});

		it('exits with code 1, destroys client, and halts without sending on remote collision', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const fatalSpy = vi
				.spyOn(logger, 'fatal')
				.mockImplementation(() => logger);
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
				throw new Error('PROCESS_EXIT_1');
			});

			const destroyMock = vi.fn().mockResolvedValue(undefined);
			const sendMock = vi.fn();

			const activeMessage = {
				content: `🔒 [INSTANCE_LOCK] ${JSON.stringify({
					instanceId: 'different-uuid-2',
					developer: 'charlie@remote-machine',
					hostname: 'remote-machine',
					pid: 8888,
					timestamp: Date.now() - 2_000, // 2s ago (< 25s TTL)
				})}`,
				delete: vi.fn(),
			} as unknown as Message;

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: vi
						.fn()
						.mockResolvedValue(new Collection([['msg-1', activeMessage]])),
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
				destroy: destroyMock,
			} as unknown as Client;

			await expect(
				distributedLock.acquireDistributedLock(client, 0),
			).rejects.toThrow('PROCESS_EXIT_1');

			expect(fatalSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					runningDev: 'charlie@remote-machine',
					hostname: 'remote-machine',
					pid: 8888,
				}),
				expect.stringContaining(
					'Another developer (charlie@remote-machine on remote-machine) is already running this bot!',
				),
			);
			expect(destroyMock).toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(sendMock).not.toHaveBeenCalled();
		});

		it('yields and deletes own message if two-phase verification detects an earlier competing message', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const fatalSpy = vi
				.spyOn(logger, 'fatal')
				.mockImplementation(() => logger);
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
				throw new Error('PROCESS_EXIT_1');
			});

			const ownDeleteMock = vi.fn().mockResolvedValue(undefined);
			const ownMessage = {
				id: '200000000000000000', // Higher snowflake (later)
				delete: ownDeleteMock,
			} as unknown as Message;

			const competitorMessage = {
				id: '100000000000000000', // Lower snowflake (earlier)
				content: `🔒 [INSTANCE_LOCK] ${JSON.stringify({
					instanceId: 'competing-uuid',
					developer: 'competitor@remote',
					hostname: 'remote',
					pid: 7777,
					timestamp: Date.now() - 100,
				})}`,
			} as unknown as Message;

			const sendMock = vi.fn().mockResolvedValue(ownMessage);
			let fetchCallCount = 0;
			const fetchMessagesMock = vi.fn().mockImplementation(() => {
				fetchCallCount++;
				if (fetchCallCount === 1) {
					// Phase 1: Pre-send sees nothing
					return Promise.resolve(new Collection());
				}
				// Phase 2: Post-send sees both own message and competitor message
				return Promise.resolve(
					new Collection([
						[ownMessage.id, ownMessage],
						[competitorMessage.id, competitorMessage],
					]),
				);
			});

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: fetchMessagesMock,
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
				destroy: vi.fn().mockResolvedValue(undefined),
			} as unknown as Client;

			await expect(
				distributedLock.acquireDistributedLock(client, 0),
			).rejects.toThrow('PROCESS_EXIT_1');

			expect(ownDeleteMock).toHaveBeenCalled();
			expect(fatalSpy).toHaveBeenCalled();
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it('runs heartbeat timer to edit message periodically', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const editMock = vi.fn().mockResolvedValue(undefined);
			const lockMessage = {
				id: 'msg-lock-1',
				edit: editMock,
			} as unknown as Message;

			const sendMock = vi.fn().mockResolvedValue(lockMessage);
			const fetchMessageMock = vi.fn().mockImplementation((arg: unknown) => {
				if (typeof arg === 'string' && arg === 'msg-lock-1') {
					return Promise.resolve(lockMessage);
				}
				return Promise.resolve(new Collection());
			});

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: fetchMessageMock,
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
			} as unknown as Client;

			await distributedLock.acquireDistributedLock(client, 0);

			// Fast-forward time by 10s (heartbeat interval)
			await vi.advanceTimersByTimeAsync(distributedLock.HEARTBEAT_INTERVAL_MS);

			expect(editMock).toHaveBeenCalledWith(
				expect.stringContaining('🔒 [INSTANCE_LOCK]'),
			);
		});

		it('handles missing/deleted lock message during heartbeat cycle gracefully', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
			const lockMessage = {
				id: 'msg-lock-1',
			} as unknown as Message;

			const sendMock = vi.fn().mockResolvedValue(lockMessage);
			const fetchMessageMock = vi.fn().mockImplementation((arg: unknown) => {
				if (typeof arg === 'string' && arg === 'msg-lock-1') {
					// Return null on heartbeat fetch to simulate external deletion
					return Promise.resolve(null);
				}
				return Promise.resolve(new Collection());
			});

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: fetchMessageMock,
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
			} as unknown as Client;

			await distributedLock.acquireDistributedLock(client, 0);

			// Advance heartbeat timer
			await vi.advanceTimersByTimeAsync(distributedLock.HEARTBEAT_INTERVAL_MS);

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Lock message was deleted or not found'),
			);
		});

		it('releases lock cleanly on releaseDistributedLock()', async () => {
			vi.spyOn(guildConfig, 'loadGuildConfig').mockReturnValue({
				'guild-1': { managerRoleId: 'role-1' },
			});

			const deleteMock = vi.fn().mockResolvedValue(undefined);
			const lockMessage = {
				id: 'msg-lock-1',
				delete: deleteMock,
			} as unknown as Message;

			const sendMock = vi.fn().mockResolvedValue(lockMessage);
			const fetchMessageMock = vi.fn().mockImplementation((arg: unknown) => {
				if (typeof arg === 'string' && arg === 'msg-lock-1') {
					return Promise.resolve(lockMessage);
				}
				return Promise.resolve(new Collection());
			});

			const channel = {
				name: distributedLock.LOCK_CHANNEL_NAME,
				type: ChannelType.GuildText,
				messages: {
					fetch: fetchMessageMock,
				},
				send: sendMock,
			} as unknown as TextChannel;

			const fakeGuild = {
				id: 'guild-1',
				name: 'Test Guild',
				channels: {
					fetch: vi.fn().mockResolvedValue(new Collection([['ch-1', channel]])),
				},
			} as unknown as Guild;

			const client = {
				guilds: {
					cache: new Collection([['guild-1', fakeGuild]]),
				},
			} as unknown as Client;

			await distributedLock.acquireDistributedLock(client, 0);

			await distributedLock.releaseDistributedLock();

			expect(deleteMock).toHaveBeenCalled();
		});
	});
});
