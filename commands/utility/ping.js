import { SlashCommandBuilder } from 'discord.js';

export default {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Pong!'),
	async execute(interaction) {
		// Use safeSend instead of reply to handle both deferred and non-deferred states
		await interaction.safeSend('Pong!');
	},
};