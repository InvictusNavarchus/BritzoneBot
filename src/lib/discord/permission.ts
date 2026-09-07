import {
	type CategoryChannel,
	type Guild,
	type GuildBasedChannel,
	type GuildMember,
	type GuildTextBasedChannel,
	PermissionsBitField,
	type StageChannel,
	type TextChannel,
	type VoiceChannel,
} from 'discord.js';
import {
	type GuildConfigMap as GuildRoleConfigMap,
	getGuildConfigStatus,
	loadGuildConfig,
	reloadGuildConfig as reloadPermissionConfig,
} from '@/lib/guildConfig.js';

export { reloadPermissionConfig };

/**
 * Returns true if the member holds the per-guild manager role.
 * Also allows the guild owner as an implicit bypass.
 */
export function isBotManager(
	member: GuildMember,
	guildConfig: GuildRoleConfigMap = loadGuildConfig(),
): boolean {
	// Guild owner always passes
	if (member.id === member.guild.ownerId) {
		return true;
	}

	const config = guildConfig[member.guild.id];
	if (!config?.managerRoleId) {
		return false;
	}

	return member.roles.cache.has(config.managerRoleId);
}

/**
 * Alias for isBotManager to check breakout invocation permission.
 */
export function canInvokeBreakout(
	member: GuildMember,
	guildConfig?: GuildRoleConfigMap,
): boolean {
	return isBotManager(member, guildConfig);
}

/**
 * Generic helper to find missing permissions for the bot in a guild channel or guild level.
 */
export function getMissingBotPermissions(
	guild: Guild,
	channel: GuildBasedChannel | null | undefined,
	requiredPermissions: bigint[],
): bigint[] {
	const me = guild.members.me;
	if (!me) return requiredPermissions;

	const perms =
		channel && 'permissionsFor' in channel
			? channel.permissionsFor(me)
			: me.permissions;

	if (!perms) return requiredPermissions;

	return requiredPermissions.filter((perm) => !perms.has(perm));
}

/**
 * Permissions the bot needs to create, rename and delete breakout channels in a
 * category (or guild-wide when no category is in play).
 */
const CHANNEL_MANAGEMENT_PERMISSIONS = [
	PermissionsBitField.Flags.ManageChannels,
	PermissionsBitField.Flags.ViewChannel,
	PermissionsBitField.Flags.Connect,
];

/** Permissions the bot needs to move members in and out of a voice channel. */
const VOICE_MOVE_PERMISSIONS = [
	PermissionsBitField.Flags.Connect,
	PermissionsBitField.Flags.MoveMembers,
	PermissionsBitField.Flags.ViewChannel,
];

/** Permissions the bot needs to post into a channel's text chat. */
const TEXT_SEND_PERMISSIONS = [
	PermissionsBitField.Flags.ViewChannel,
	PermissionsBitField.Flags.SendMessages,
];

/**
 * Utility to convert permission bitfield flags into human-readable labels.
 */
export function formatPermissionNames(permissions: bigint[]): string {
	if (permissions.length === 0) return '';
	const bitField = new PermissionsBitField(permissions);
	const names = bitField.toArray();
	return names
		.map((name) => name.replace(/([a-z])([A-Z])/g, '$1 $2'))
		.join(', ');
}

/**
 * Checks if bot has ManageChannels permission in target category or guild.
 */
export function canBotManageChannels(
	guild: Guild,
	category?: CategoryChannel | GuildBasedChannel | null,
): boolean {
	return (
		getMissingBotPermissions(guild, category, [
			PermissionsBitField.Flags.ManageChannels,
			PermissionsBitField.Flags.ViewChannel,
		]).length === 0
	);
}

/**
 * Checks if bot has Connect, MoveMembers, and ViewChannel permissions on a voice/stage channel.
 */
export function canBotMoveMembers(
	guild: Guild,
	voiceChannel?: VoiceChannel | StageChannel | GuildBasedChannel | null,
): boolean {
	return (
		getMissingBotPermissions(guild, voiceChannel, VOICE_MOVE_PERMISSIONS)
			.length === 0
	);
}

/**
 * Checks if bot has ViewChannel and SendMessages permissions in a text/voice channel.
 */
export function canBotSendMessage(
	guild: Guild,
	textChannel?: TextChannel | GuildTextBasedChannel | GuildBasedChannel | null,
): boolean {
	return (
		getMissingBotPermissions(guild, textChannel, TEXT_SEND_PERMISSIONS)
			.length === 0
	);
}

/**
 * Checks if member has MoveMembers permission directly.
 */
export function canMemberMoveMembers(member: GuildMember): boolean {
	return member.permissions.has(PermissionsBitField.Flags.MoveMembers);
}

export interface BreakoutPreflightOptions {
	member: GuildMember;
	category?: CategoryChannel | GuildBasedChannel | null;
	voiceChannel?: VoiceChannel | StageChannel | GuildBasedChannel | null;
	textChannel?: TextChannel | GuildTextBasedChannel | GuildBasedChannel | null;
	channels?: (GuildBasedChannel | null | undefined)[];
	requireUserMove?: boolean;
	requireManageChannels?: boolean;
}

export interface BreakoutPreflightResult {
	ok: boolean;
	reason?: string;
}

/**
 * Composite preflight permission check for breakout room operations.
 */
export function preflightBreakout(
	opts: BreakoutPreflightOptions,
	guildConfigMap: GuildRoleConfigMap = loadGuildConfig(),
): BreakoutPreflightResult {
	const {
		member,
		category,
		voiceChannel,
		textChannel,
		channels,
		requireUserMove,
		requireManageChannels,
	} = opts;
	const guild = member.guild;

	// 1. Role gate (Owner bypass or manager role)
	if (!canInvokeBreakout(member, guildConfigMap)) {
		const configStatus = getGuildConfigStatus(guild.id, guildConfigMap);
		if (configStatus === 'FILE_MISSING') {
			return {
				ok: false,
				reason:
					'⚠️ Server configuration file (`guildConfig.json`) was not found. Please set up `guildConfig.json` before using this command.',
			};
		}

		if (configStatus === 'GUILD_NOT_CONFIGURED') {
			return {
				ok: false,
				reason:
					'⚠️ Bot configuration (`managerRoleId`) for this server is not set in `guildConfig.json`.',
			};
		}

		return {
			ok: false,
			reason: 'You do not have the required manager role for this server.',
		};
	}

	// 2. User move members permission check (optional)
	if (requireUserMove && !canMemberMoveMembers(member)) {
		return {
			ok: false,
			reason: 'You need the **Move Members** permission to use this command.',
		};
	}

	// 3. Bot capability checks.
	//
	// Every failure is collected before returning. Reporting only the first one
	// meant an admin who fixed the category came straight back to a second error
	// about the voice channel, then a third about a breakout room — one
	// round-trip through Discord's permission UI per missing grant.
	const failures: string[] = [];

	const recordMissing = (
		channel: GuildBasedChannel | null | undefined,
		required: bigint[],
		where: string,
	): void => {
		const missing = getMissingBotPermissions(guild, channel, required);
		if (missing.length > 0) {
			failures.push(`**${formatPermissionNames(missing)}** ${where}`);
		}
	};

	if (category) {
		recordMissing(
			category,
			CHANNEL_MANAGEMENT_PERMISSIONS,
			`in the target category (${category.name})`,
		);
	}

	if (
		requireManageChannels &&
		!category &&
		(!channels || channels.length === 0)
	) {
		recordMissing(null, CHANNEL_MANAGEMENT_PERMISSIONS, 'in this server');
	}

	if (channels && channels.length > 0) {
		for (const ch of channels) {
			if (!ch) continue;
			recordMissing(
				ch,
				CHANNEL_MANAGEMENT_PERMISSIONS,
				`on breakout room ${ch.name}`,
			);
		}
	}

	if (voiceChannel) {
		recordMissing(
			voiceChannel,
			VOICE_MOVE_PERMISSIONS,
			`in voice channel ${voiceChannel.name}`,
		);
	}

	if (textChannel) {
		recordMissing(
			textChannel,
			TEXT_SEND_PERMISSIONS,
			`in channel ${textChannel.name}`,
		);
	}

	if (failures.length > 0) {
		const intro =
			failures.length === 1
				? "I'm missing a permission:"
				: `I'm missing ${failures.length} permissions:`;
		return {
			ok: false,
			reason: `${intro}\n${failures
				.map((failure) => `• ${failure}`)
				.join('\n')}\nAsk an admin to grant them.`,
		};
	}

	return { ok: true };
}
