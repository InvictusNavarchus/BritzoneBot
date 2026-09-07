import { Collection, type GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
	parseMentions,
	resolveMentionedUserIds,
} from '@/modules/breakout/utils/mentions.js';

/** Builds a member carrying the given role IDs. */
function member(id: string, roleIds: string[] = []): GuildMember {
	return {
		id,
		roles: { cache: new Collection(roleIds.map((r) => [r, { id: r }])) },
	} as unknown as GuildMember;
}

describe('parseMentions', () => {
	it('parses user mentions in both plain and nickname form', () => {
		const parsed = parseMentions('<@111> <@!222>');
		expect([...parsed.userIds]).toEqual(['111', '222']);
		expect([...parsed.roleIds]).toEqual([]);
		expect(parsed.unrecognized).toEqual([]);
	});

	it('parses role mentions, which were previously dropped entirely', () => {
		const parsed = parseMentions('<@&999>');
		expect([...parsed.roleIds]).toEqual(['999']);
		expect([...parsed.userIds]).toEqual([]);
	});

	it('separates users and roles in a mixed input', () => {
		const parsed = parseMentions('<@111> <@&999> <@!222>');
		expect([...parsed.userIds]).toEqual(['111', '222']);
		expect([...parsed.roleIds]).toEqual(['999']);
		expect(parsed.unrecognized).toEqual([]);
	});

	it('reports tokens that are neither a user nor a role mention', () => {
		// Typing a plain name instead of a mention looks identical to success.
		const parsed = parseMentions('Alice <@111> @Bob');
		expect(parsed.unrecognized).toEqual(['Alice', '@Bob']);
		expect([...parsed.userIds]).toEqual(['111']);
	});

	it('handles empty and null input', () => {
		for (const input of [null, '', '   ']) {
			const parsed = parseMentions(input);
			expect(parsed.userIds.size).toBe(0);
			expect(parsed.roleIds.size).toBe(0);
			expect(parsed.unrecognized).toEqual([]);
		}
	});

	it('deduplicates repeated mentions', () => {
		const parsed = parseMentions('<@111> <@!111> <@&9> <@&9>');
		expect([...parsed.userIds]).toEqual(['111']);
		expect([...parsed.roleIds]).toEqual(['9']);
	});
});

describe('resolveMentionedUserIds', () => {
	const candidates = [
		member('u1', ['role-fac']),
		member('u2', ['role-other']),
		member('u3', ['role-fac', 'role-other']),
		member('u4'),
	];

	it('returns directly mentioned users unchanged', () => {
		const resolved = resolveMentionedUserIds(
			parseMentions('<@u4>'.replace('u4', '444')),
			candidates,
		);
		expect([...resolved]).toEqual(['444']);
	});

	it('expands a role mention to its members present in the pool', () => {
		const resolved = resolveMentionedUserIds(
			parseMentions('<@&role-fac>'.replace('role-fac', '1')),
			[member('u1', ['1']), member('u2', ['2']), member('u3', ['1'])],
		);
		expect([...resolved].sort()).toEqual(['u1', 'u3']);
	});

	it('unions users and roles without duplicating an overlapping member', () => {
		const resolved = resolveMentionedUserIds(
			{
				userIds: new Set(['u1']),
				roleIds: new Set(['role-fac']),
				unrecognized: [],
			},
			candidates,
		);
		expect([...resolved].sort()).toEqual(['u1', 'u3']);
	});

	it('ignores a role nobody in the pool holds', () => {
		const resolved = resolveMentionedUserIds(
			{ userIds: new Set(), roleIds: new Set(['absent']), unrecognized: [] },
			candidates,
		);
		expect(resolved.size).toBe(0);
	});

	it('does not walk the pool when no roles were mentioned', () => {
		const resolved = resolveMentionedUserIds(
			{ userIds: new Set(['x']), roleIds: new Set(), unrecognized: [] },
			[],
		);
		expect([...resolved]).toEqual(['x']);
	});
});
