import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {
	REST,
	type RESTPostAPIChatInputApplicationCommandsJSONBody,
	Routes,
} from 'discord.js';
import pino from 'pino';
import { type GuildConfig, loadGuildConfig } from '@/lib/guildConfig.js';
import { logger } from '@/lib/logger.js';
import { listModuleFiles, moduleExtensionOf } from '@/lib/moduleFiles.js';
import type { Command } from '@/types/index.js';

const __dirname = import.meta.dirname;
const moduleExtension = moduleExtensionOf(import.meta.url);

const { BOT_ID, TOKEN } = process.env;

if (!BOT_ID || !TOKEN) {
	throw new Error('BOT_ID and TOKEN must be defined in environment variables');
}

const botId: string = BOT_ID;
const token: string = TOKEN;

const guildConfig = loadGuildConfig();

if (Object.keys(guildConfig).length === 0) {
	const finalLogger = (
		pino as unknown as { final: (logger: pino.Logger) => pino.Logger }
	).final(logger);
	finalLogger.fatal(
		'Error: guildConfig.json not found or empty. Please copy guildConfig.json.example to guildConfig.json and configure your guild IDs.',
	);
	process.exit(1);
}

const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
// Grab all the command folders from the commands directory
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	// Grab all the command files from the commands directory
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = listModuleFiles(commandsPath, moduleExtension);
	logger.info(`loading commands from ${folder}/`);
	logger.debug({ commandFiles }, 'Found command files');

	// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const module = (await import(filePath)) as { default: Command };
		const command = module.default;

		if ('data' in command && 'execute' in command) {
			commands.push(
				command.data.toJSON() as RESTPostAPIChatInputApplicationCommandsJSONBody,
			);
		} else {
			logger.warn(
				{ filePath },
				`[WARNING] Command is missing required "data" or "execute" property.`,
			);
		}
	}
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

/**
 * Deploys commands to a specific guild
 * @param guildName The name of the guild
 * @param guildId The ID of the guild
 */
async function deployCommands(
	guildName: string,
	guildId: string,
): Promise<void> {
	try {
		logger.info(
			`Started refreshing ${commands.length} application (/) commands on guild ${guildName} (${guildId}).`,
		);

		// The put method is used to fully refresh all commands in the guild with the current set
		const data = (await rest.put(
			Routes.applicationGuildCommands(botId, guildId),
			{
				body: commands,
			},
		)) as unknown[];

		logger.info(
			`✅ Successfully reloaded ${data.length} application (/) commands on ${guildName} (${guildId}).`,
		);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		logger.error({ err: error }, 'Failed to deploy commands');
	}
}

// Deploy commands to all guilds in the configuration
for (const [guildId, config] of Object.entries(guildConfig) as [
	string,
	GuildConfig,
][]) {
	const displayName = config.name || guildId;
	await deployCommands(displayName, guildId);
}
