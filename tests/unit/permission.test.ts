import {
	type CategoryChannel,
	type Guild,
	GuildMember,
	PermissionsBitField,
	type VoiceChannel,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
	canBotManageChannels,
	canBotMoveMembers,
	canBotSendMessage,
	canInvokeBreakout,
	canMemberMoveMembers,
	formatPermissionNames,
	getMissingBotPermissions,
	isBotManager,
	preflightBreakout,
	preflightBreakoutFor,
	reloadPermissionConfig,
} from '@/lib/discord/permission.js';

describe('Discord Permission Utilities (permission.ts)', () => {
	it('allows access when member is the guild owner (owner bypass)', () => {
		const member = {
			id: 'owner-123',
			guild: { id: 'guild-1', ownerId: 'owner-123' },
			roles: { cache: { has: () => false } },
		} as unknown as GuildMember;

		expect(isBotManager(member, {})).toBe(true);
		expect(canInvokeBreakout(member, {})).toBe(true);
	});

	it('allows access when the guild has a matching manager role', () => {
		const member = {
			id: 'user-1',
			guild: { id: 'guild-1', ownerId: 'owner-999' },
			roles: {
				cache: {
					has: (roleId: string) => roleId === 'role-1',
				},
			},
		} as unknown as GuildMember;

		expect(
			isBotManager(member, {
				'guild-1': { managerRoleId: 'role-1' },
			}),
		).toBe(true);
	});

	it('denies access when the guild config does not match the member role', () => {
		const member = {
			id: 'user-2',
			guild: { id: 'guild-2', ownerId: 'owner-999' },
			roles: {
				cache: {
					has: (roleId: string) => roleId === 'role-1',
				},
			},
		} as unknown as GuildMember;

		expect(
			isBotManager(member, {
				'guild-2': { managerRoleId: 'role-2' },
			}),
		).toBe(false);
	});

	it('denies access when no guild config exists', () => {
		const member = {
			id: 'user-3',
			guild: { id: 'guild-3', ownerId: 'owner-999' },
			roles: {
				cache: {
					has: () => false,
				},
			},
		} as unknown as GuildMember;

		expect(isBotManager(member, {})).toBe(false);
	});

	it('allows force-reloading permission config', () => {
		expect(() => reloadPermissionConfig()).not.toThrow();
	});

	describe('Bot capability checks', () => {
		it('canBotManageChannels checks bot permissions on category', () => {
			const me = { id: 'bot-1' };
			const category = {
				permissionsFor: (target: unknown) =>
					target === me ? { has: () => true } : null,
			} as unknown as CategoryChannel;

			const guild = {
				members: { me },
			} as unknown as Guild;

			expect(canBotManageChannels(guild, category)).toBe(true);
		});

		it('canBotMoveMembers returns false if bot is missing perms', () => {
			const me = { id: 'bot-1' };
			const voiceChannel = {
				permissionsFor: () => ({ has: () => false }),
			} as unknown as VoiceChannel;

			const guild = {
				members: { me },
			} as unknown as Guild;

			expect(canBotMoveMembers(guild, voiceChannel)).toBe(false);
		});

		it('canBotSendMessage returns true if bot has send permissions', () => {
			const me = { id: 'bot-1' };
			const textChannel = {
				permissionsFor: () => ({ has: () => true }),
			} as unknown as CategoryChannel;

			const guild = {
				members: { me },
			} as unknown as Guild;

			expect(canBotSendMessage(guild, textChannel)).toBe(true);
		});

		it('returns false when guild.members.me is null', () => {
			const guild = { members: { me: null } } as unknown as Guild;
			expect(canBotManageChannels(guild)).toBe(false);
			expect(canBotMoveMembers(guild)).toBe(false);
			expect(canBotSendMessage(guild)).toBe(false);
		});

		it('getMissingBotPermissions correctly identifies missing flags', () => {
			const me = { id: 'bot-1' };
			const voiceChannel = {
				permissionsFor: () => ({
					has: (perm: bigint) => perm === PermissionsBitField.Flags.ViewChannel,
				}),
			} as unknown as VoiceChannel;
			const guild = { members: { me } } as unknown as Guild;

			const missing = getMissingBotPermissions(guild, voiceChannel, [
				PermissionsBitField.Flags.Connect,
				PermissionsBitField.Flags.MoveMembers,
				PermissionsBitField.Flags.ViewChannel,
			]);

			expect(missing).toEqual([
				PermissionsBitField.Flags.Connect,
				PermissionsBitField.Flags.MoveMembers,
			]);
		});

		it('reports only the permissions the caller asked about', () => {
			// ViewChannel used to be unshifted into every channel-scoped request,
			// so the message could name a permission the caller never checked.
			const me = { id: 'bot-1' };
			const channel = {
				permissionsFor: () => ({ has: () => false }),
			} as unknown as VoiceChannel;
			const guild = { members: { me } } as unknown as Guild;

			const missing = getMissingBotPermissions(guild, channel, [
				PermissionsBitField.Flags.ManageChannels,
			]);

			expect(missing).toEqual([PermissionsBitField.Flags.ManageChannels]);
			expect(missing).not.toContain(PermissionsBitField.Flags.ViewChannel);
		});

		it('formatPermissionNames converts bitfield array into formatted string', () => {
			const formatted = formatPermissionNames([
				PermissionsBitField.Flags.ManageChannels,
				PermissionsBitField.Flags.MoveMembers,
			]);
			expect(formatted).toBe('Manage Channels, Move Members');
			expect(formatPermissionNames([])).toBe('');
		});
	});

	describe('User capability checks', () => {
		it('canMemberMoveMembers checks member permissions', () => {
			const member = {
				permissions: { has: () => true },
			} as unknown as GuildMember;

			expect(canMemberMoveMembers(member)).toBe(true);
		});
	});

	describe('preflightBreakout composite check', () => {
		it('reports missing guildConfig.json when file is absent', () => {
			const member = {
				id: 'user-1',
				guild: { id: 'guild-1', ownerId: 'owner-999' },
				roles: { cache: { has: () => false } },
			} as unknown as GuildMember;

			const result = preflightBreakout({ member });
			expect(result.ok).toBe(false);
			expect(result.reason).toContain('guildConfig.json');
		});

		it('fails if member does not have manager role when guild is configured', () => {
			const member = {
				id: 'user-1',
				guild: { id: 'guild-1', ownerId: 'owner-999' },
				roles: { cache: { has: () => false } },
			} as unknown as GuildMember;

			const result = preflightBreakout(
				{ member },
				{ 'guild-1': { managerRoleId: 'role-99' } },
			);
			expect(result.ok).toBe(false);
			expect(result.reason).toContain('manager role');
		});

		it('reports every failing scope at once rather than the first', () => {
			const me = { id: 'bot-1' };
			// The bot can do nothing anywhere, so the category, the breakout room
			// and the voice channel should all be named in one message.
			const denyAll = () => ({ has: () => false });
			const category = {
				name: 'FGD Sessions',
				permissionsFor: denyAll,
			} as unknown as CategoryChannel;
			const room = {
				name: 'breakout-room-1',
				permissionsFor: denyAll,
			} as unknown as VoiceChannel;
			const voiceChannel = {
				name: 'Main Room',
				permissionsFor: denyAll,
			} as unknown as VoiceChannel;

			const member = {
				id: 'owner-999',
				guild: { id: 'guild-1', ownerId: 'owner-999', members: { me } },
				roles: { cache: { has: () => false } },
				permissions: { has: () => true },
			} as unknown as GuildMember;

			const result = preflightBreakout({
				member,
				category,
				channels: [room],
				voiceChannel,
			});

			expect(result.ok).toBe(false);
			expect(result.reason).toContain('FGD Sessions');
			expect(result.reason).toContain('breakout-room-1');
			expect(result.reason).toContain('Main Room');
			expect(result.reason).toContain("I'm missing 3 permissions:");
		});

		it('groups multiple breakout rooms sharing identical missing permissions', () => {
			const me = { id: 'bot-1' };
			const denyAll = () => ({ has: () => false });
			const rooms = [
				{
					name: 'breakout-room-1',
					permissionsFor: denyAll,
				} as unknown as VoiceChannel,
				{
					name: 'breakout-room-2',
					permissionsFor: denyAll,
				} as unknown as VoiceChannel,
				{
					name: 'breakout-room-3',
					permissionsFor: denyAll,
				} as unknown as VoiceChannel,
				{
					name: 'breakout-room-4',
					permissionsFor: denyAll,
				} as unknown as VoiceChannel,
			];
			const member = {
				id: 'owner-999',
				guild: { id: 'guild-1', ownerId: 'owner-999', members: { me } },
				roles: { cache: { has: () => false } },
				permissions: { has: () => true },
			} as unknown as GuildMember;

			const result = preflightBreakout({
				member,
				channels: rooms,
			});

			expect(result.ok).toBe(false);
			expect(result.reason).toContain('4 breakout rooms');
			expect(result.reason).toContain('(and 1 more)');
		});

		it('uses singular phrasing for a lone failure', () => {
			const me = { id: 'bot-1' };
			const category = {
				name: 'FGD Sessions',
				permissionsFor: () => ({ has: () => false }),
			} as unknown as CategoryChannel;

			const member = {
				id: 'owner-999',
				guild: { id: 'guild-1', ownerId: 'owner-999', members: { me } },
				roles: { cache: { has: () => false } },
				permissions: { has: () => true },
			} as unknown as GuildMember;

			const result = preflightBreakout({ member, category });

			expect(result.ok).toBe(false);
			expect(result.reason).toContain("I'm missing a permission:");
			expect(result.reason).not.toContain('breakout room');
		});

		it('skips null entries in the channels list', () => {
			const me = { id: 'bot-1' };
			const member = {
				id: 'owner-999',
				guild: { id: 'guild-1', ownerId: 'owner-999', members: { me } },
				roles: { cache: { has: () => false } },
				permissions: { has: () => true },
			} as unknown as GuildMember;

			const result = preflightBreakout({ member, channels: [null, undefined] });
			expect(result.ok).toBe(true);
		});

		it('fails closed when the invoking member is not hydrated', () => {
			// An APIInteractionGuildMember (cache miss) is not a GuildMember, and
			// the old `if (member instanceof GuildMember)` wrapper skipped the check
			// entirely in exactly that case.
			const result = preflightBreakoutFor(
				{ member: { user: { id: 'user-1' } } },
				{ requireUserMove: true },
			);

			expect(result.ok).toBe(false);
			expect(result.reason).toBe('Unable to verify your permissions.');
		});

		it('runs the full check for a hydrated member', () => {
			const me = { id: 'bot-1', permissions: { has: () => true } };
			const member = {
				id: 'owner-999',
				guild: { id: 'guild-1', ownerId: 'owner-999', members: { me } },
				roles: { cache: { has: () => false } },
				permissions: { has: () => true },
			} as unknown as GuildMember;
			Object.setPrototypeOf(member, GuildMember.prototype);

			expect(preflightBreakoutFor({ member }).ok).toBe(true);
		});

		it('succeeds for owner bypass', () => {
			const me = { permissions: { has: () => true } };
			const member = {
				id: 'owner-999',
				guild: { id: 'guild-1', ownerId: 'owner-999', members: { me } },
				roles: { cache: { has: () => false } },
				permissions: { has: () => true },
			} as unknown as GuildMember;

			const result = preflightBreakout({ member });
			expect(result.ok).toBe(true);
		});
	});
});
