import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
const __dirname = import.meta.dirname;

const { BOT_ID, TOKEN } = process.env;

// Read and parse the guildList.json file
const guildList = JSON.parse(fs.readFileSync('guildList.json', 'utf-8'));

const commands = [];
// Grab all the command folders from the commands directory you created earlier
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    // Grab all the command files from the commands directory you created earlier
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    console.log(`loading commands from ${folder}/`);
    console.log(commandFiles);
    // Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = (await import(filePath)).default;
        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(TOKEN);

// and deploy your commands!
async function deployCommands(GUILD_NAME, GUILD_ID) {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands on guild ${GUILD_NAME} (${GUILD_ID}).`);

        // The put method is used to fully refresh all commands in the guild with the current set
        const data = await rest.put(
            Routes.applicationGuildCommands(BOT_ID, GUILD_ID),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        // And of course, make sure you catch and log any errors!
        console.error(error);
    }
};

for (let [GUILD_NAME, GUILD_ID] of Object.entries(guildList)) {
    deployCommands(GUILD_NAME, GUILD_ID);
}