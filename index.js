import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import consoleStamp from 'console-stamp';
const __dirname = import.meta.dirname;

// Configure console-stamp
consoleStamp(console, { format: ':date(HH:MM:ss)' });

// Modify console.log to write to a log file
const logDir = path.join(__dirname, 'log');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}
const logFile = path.join(logDir, `${new Date().toISOString().split('T')[0]}.log`);

const originalConsoleLog = console.log;
/**
 * @param {string} message - The message to log
 * @param {...any} optionalParams - Optional parameters to log
 */
console.log = function(message, ...optionalParams) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
    originalConsoleLog.apply(console, [message, ...optionalParams]);
};

console.log('🚀 Starting the bot...');

const token = process.env.TOKEN;

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates
	] }
);

client.commands = new Collection();
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

console.log('📂 Loading commands...');
for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = (await import(filePath)).default;
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
			console.log(`✅ Command loaded: ${command.data.name}`);
		} else {
			console.log(`⚠️ [WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

console.log('🎉 Loading events...');
for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = (await import(filePath)).default;
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
		console.log(`🔄 One-time event loaded: ${event.name}`);
	} else {
		client.on(event.name, (...args) => event.execute(...args));
		console.log(`🔁 Event loaded: ${event.name}`);
	}
}

console.log('🔑 Logging in...');
client.login(token).then(() => {
	console.log('✅ Bot logged in successfully!');
}).catch(err => {
	console.log(`❌ Failed to log in: ${err}`);
});