import { SlashCommandBuilder } from 'discord.js';
import safeReply, { replyOrEdit } from '../../helpers/safeReply.js';

export default {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Pong!'),
	async execute(interaction) {
		await safeReply(interaction, async () => {
			return replyOrEdit(interaction, 'Pong!');
		});
	},
};