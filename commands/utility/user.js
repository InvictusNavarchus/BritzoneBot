import { SlashCommandBuilder } from 'discord.js';
import safeReply, { replyOrEdit } from '../../helpers/safeReply.js';

export default {
	data: new SlashCommandBuilder()
		.setName('user')
		.setDescription('Provides information about the user.'),
	async execute(interaction) {
		await safeReply(interaction, async () => {
			const response = `This command was run by ${interaction.user.username}, who joined on ${interaction.member.joinedAt}.`;
			return replyOrEdit(interaction, response);
		});
	},
};