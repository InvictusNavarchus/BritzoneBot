import type { GuildMember } from 'discord.js';

/**
 * Mentions parsed out of an `exclude` or `facilitators` option.
 */
export interface ParsedMentions {
	/** Directly mentioned users, e.g. `<@123>` or `<@!123>`. */
	userIds: Set<string>;
	/** Mentioned roles, e.g. `<@&123>`, to be expanded against the member pool. */
	roleIds: Set<string>;
	/** Tokens that were neither, kept so the user can be told they did nothing. */
	unrecognized: string[];
}

/**
 * Parses user and role mentions from a command string option.
 *
 * Role mentions (`<@&123>`) use a different syntax to user mentions and were
 * previously unmatched and silently dropped, so `facilitators:@Facilitator`
 * assigned nobody and the manager only found out by reading the preview.
 * Anything that is neither is reported rather than ignored — a plain name typed
 * instead of a mention is the common mistake, and it looks identical to success.
 */
export function parseMentions(input: string | null): ParsedMentions {
	const userIds = new Set<string>();
	const roleIds = new Set<string>();
	const unrecognized: string[] = [];

	if (!input) return { userIds, roleIds, unrecognized };

	for (const token of input.split(/\s+/).filter(Boolean)) {
		const user = token.match(/^<@!?(\d+)>$/);
		if (user) {
			userIds.add(user[1]);
			continue;
		}

		const role = token.match(/^<@&(\d+)>$/);
		if (role) {
			roleIds.add(role[1]);
			continue;
		}

		unrecognized.push(token);
	}

	return { userIds, roleIds, unrecognized };
}

/**
 * Resolves parsed mentions to concrete user IDs, expanding role mentions to the
 * members of that role who are actually present in the candidate pool.
 *
 * Expanding against the pool rather than the whole guild keeps the result to
 * people who are in voice and therefore actually distributable.
 */
export function resolveMentionedUserIds(
	parsed: ParsedMentions,
	candidates: Iterable<GuildMember>,
): Set<string> {
	const resolved = new Set(parsed.userIds);
	if (parsed.roleIds.size === 0) return resolved;

	for (const member of candidates) {
		for (const roleId of parsed.roleIds) {
			if (member.roles.cache.has(roleId)) {
				resolved.add(member.id);
				break;
			}
		}
	}

	return resolved;
}
