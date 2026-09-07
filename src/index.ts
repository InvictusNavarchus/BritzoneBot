/**
 * BritzoneBot - Discord Bot with TypeScript
 *
 * This is the migrated TypeScript version of your bot entry point.
 * It demonstrates proper TypeScript patterns for discord.js v14.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, Collection, GatewayIntentBits, RESTEvents } from 'discord.js';
import { releaseDistributedLock } from '@/lib/distributedLock.js';
import { logger } from '@/lib/logger.js';
import { listModuleFiles, moduleExtensionOf } from '@/lib/moduleFiles.js';
import { flushState, initializeState } from '@/modules/breakout/state/state.js';
import type { BritzoneClient, Command, Event } from '@/types/index.js';

const __dirname = import.meta.dirname;
const moduleExtension = moduleExtensionOf(import.meta.url);

// ============================================================================
// LOGGING SETUP
// ============================================================================

import { validateEnv } from '@/lib/env.js';
import { guildConfigExists, loadGuildConfig } from '@/lib/guildConfig.js';

logger.info('🚀 Starting the bot...');
await initializeState();

// Validate environment variables early before proceeding
const env = validateEnv();

// Validate guildConfig.json existence and log startup warning if missing
if (!guildConfigExists() || Object.keys(loadGuildConfig()).length === 0) {
	logger.warn(
		'⚠️ guildConfig.json was not found or contains no guild configs. Please copy guildConfig.json.example to guildConfig.json and configure your server IDs and managerRoleId.',
	);
}

const token = env.TOKEN;

// Create client with proper typing
const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
}) as BritzoneClient;

// Initialize commands collection with proper typing
client.commands = new Collection<string, Command>();

// ============================================================================
// REST RATE LIMIT MONITORING
// ============================================================================
client.rest.on(RESTEvents.Response, (request, response) => {
	const limit = response.headers.get('x-ratelimit-limit');
	const remaining = response.headers.get('x-ratelimit-remaining');
	const resetAfter = response.headers.get('x-ratelimit-reset-after');
	const bucket = response.headers.get('x-ratelimit-bucket');

	logger.debug(
		{
			method: request.method,
			path: request.path,
			bucket,
			quota: `${remaining}/${limit}`,
			resetAfter: `${resetAfter}s`,
		},
		`[REST Response] ${request.method} ${request.path}`,
	);

	if (remaining !== null && Number(remaining) <= 1) {
		logger.warn(
			{ bucket, path: request.path },
			`⚠️ Bucket ${bucket} is almost exhausted!`,
		);
	}
});

// ============================================================================
// COMMAND LOADING
// ============================================================================

logger.info('📂 Loading commands...');

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = listModuleFiles(commandsPath, moduleExtension);

	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);

		try {
			// Dynamic import with type casting
			const module = (await import(filePath)) as { default: Command };
			const command = module.default;

			// Type guard: ensure command has required properties
			if ('data' in command && 'execute' in command) {
				client.commands.set(command.data.name, command);
				logger.info({ command: command.data.name }, `✅ Command loaded`);
			} else {
				logger.warn(
					{ filePath },
					`⚠️ [WARNING] Command is missing required "data" or "execute" property.`,
				);
			}
		} catch (error) {
			logger.error({ err: error, filePath }, `❌ Error loading command`);
		}
	}
}

// ============================================================================
// EVENT LOADING
// ============================================================================

logger.info('🎉 Loading events...');

const eventsPath = path.join(__dirname, 'events');
const eventFiles = listModuleFiles(eventsPath, moduleExtension);

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);

	try {
		// Dynamic import with type casting
		const module = (await import(filePath)) as { default: Event };
		const event = module.default;

		// Type guard: check if event has required properties
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
			logger.info(
				{ event: event.name },
				`🔄 One-time event loaded: ${event.name}`,
			);
		} else {
			client.on(event.name, (...args) => event.execute(...args));
			logger.info({ event: event.name }, `🔁 Event loaded: ${event.name}`);
		}
	} catch (error) {
		logger.error(
			{ err: error, filePath },
			`❌ Error loading event from ${filePath}:`,
		);
	}
}

// ============================================================================
// BOT LOGIN
// ============================================================================

logger.info('🔑 Logging in...');
client
	.login(token)
	.then(() => {
		logger.info('✅ Bot logged in successfully!');
	})
	.catch((err: Error) => {
		logger.fatal({ err }, `❌ Failed to log in: ${err.message}`);
		process.exit(1);
	});

// ============================================================================
// GRACEFUL SHUTDOWN & ERROR HANDLING
// ============================================================================

let isShuttingDown = false;

const handleShutdown = async (signal: string) => {
	if (isShuttingDown) return;
	isShuttingDown = true;

	logger.info(`🛑 Received ${signal}, initiating graceful shutdown...`);

	// Force exit timeout in case cleanup hangs
	const forceExitTimeout = setTimeout(() => {
		logger.error('⏰ Shutdown timed out. Forcing exit.');
		process.exit(1);
	}, 5000);
	forceExitTimeout.unref();

	try {
		await releaseDistributedLock();
		client.destroy();
		logger.info('🔌 Discord client destroyed.');

		await flushState();
		logger.info('💾 State flushed to disk successfully.');

		logger.info('👋 Graceful shutdown complete.');
		process.exit(0);
	} catch (error) {
		logger.error({ err: error }, '❌ Error during graceful shutdown');
		process.exit(1);
	}
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		handleShutdown(signal);
	});
}

// Handle unhandled promise rejections
process.on(
	'unhandledRejection',
	(reason: unknown, _promise: Promise<unknown>) => {
		logger.error({ err: reason }, '❌ Unhandled Promise Rejection:');
	},
);

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
	logger.fatal({ err: error }, '❌ Uncaught Exception:');
	process.exit(1);
});
