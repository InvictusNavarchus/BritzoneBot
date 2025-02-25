import { SlashCommandBuilder } from 'discord.js';

export default {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Provides information about the server.'),
	async execute(interaction) {
		// Use safeSend instead of reply to handle both deferred and non-deferred states
		await interaction.safeSend(`This server is ${interaction.guild.name} and has ${interaction.guild.memberCount} members.`);
	},
};