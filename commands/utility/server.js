import { SlashCommandBuilder } from 'discord.js';
import safeReply, { replyOrEdit } from '../../helpers/safeReply.js';

export default {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Provides information about the server.'),
	async execute(interaction) {
		await safeReply(interaction, async () => {
			const response = `This server is ${interaction.guild.name} and has ${interaction.guild.memberCount} members.`;
			return replyOrEdit(interaction, response);
		});
	},
};