import { SlashCommandBuilder } from 'discord.js';

export default {
	data: new SlashCommandBuilder()
		.setName('user')
		.setDescription('Provides information about the user.'),
	async execute(interaction) {
		// Use safeSend instead of reply to handle both deferred and non-deferred states
		await interaction.safeSend(`This command was run by ${interaction.user.username}, who joined on ${interaction.member.joinedAt}.`);
	},
};