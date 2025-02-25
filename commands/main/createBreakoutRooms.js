import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import safeReply from '../../helpers/safeReply.js';
import createChannel from '../../helpers/createChannel.js';

export default {
  data: new SlashCommandBuilder()
    .setName("create-breakout-rooms")
    .setDescription("Creates multiple breakout voice channels")
    .addIntegerOption((option) =>
      option
        .setName("number")
        .setDescription("Enter the number of breakout rooms to create")
        .setMinValue(1)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    console.log(`🚀 Create Breakout Rooms command initiated by ${interaction.user.tag}`);

    await safeReply(interaction, async () => {
      const numRooms = interaction.options.getInteger("number");
      console.log(`🔢 Number of breakout rooms to create: ${numRooms}`);

      try {
        const createdChannels = [];
        const parent = interaction.channel.parent || interaction.guild;
        
        // Create channels using helper function
        for (let i = 1; i <= numRooms; i++) {
          const channel = await createChannel(parent, `breakout-room-${i}`);
          createdChannels.push(channel);
        }

        await interaction.safeSend({
          content: `Successfully created ${numRooms} breakout voice channels${
            interaction.channel.parent ? ' in the same category' : ''
          }!`,
        });
      } catch (error) {
        console.error(`❌ Error creating breakout rooms:`, error);
        await interaction.safeSend({
          content: "An error occurred while creating breakout rooms. Please ensure the bot has the necessary permissions!",
        });
      }
    }, { deferReply: true, ephemeral: true });
  },
};
