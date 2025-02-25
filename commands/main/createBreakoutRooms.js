import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import safeReply from '../../helpers/safeReply.js';

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

    // Use the safe reply helper to handle the rest of the command
    await safeReply(interaction, async () => {
      // Retrieve the number of rooms from the command options
      const numRooms = interaction.options.getInteger("number");
      console.log(`🔢 Number of breakout rooms to create: ${numRooms}`);

      try {
        // Array to store created channels (if needed for further processing)
        const createdChannels = [];

        // Check if the command was used in a channel with a parent category
        if (interaction.channel.parent) {
          console.log(`📂 Creating channels in the same category: ${interaction.channel.parent.name}`);
          // Create channels in the same category
          for (let i = 1; i <= numRooms; i++) {
            const channel = await interaction.channel.parent.children.create({
              name: `breakout-room-${i}`,
              type: ChannelType.GuildVoice,
            });
            createdChannels.push(channel);
            console.log(`✅ Created channel: ${channel.name}`);
          }
          await interaction.safeSend({
            content: `Successfully created ${numRooms} breakout voice channels in the same category!`,
          });
        } else {
          console.log(`📂 Creating channels as stray channels in the guild`);
          // Create channels as stray channels in the guild
          for (let i = 1; i <= numRooms; i++) {
            const channel = await interaction.guild.channels.create({
              name: `breakout-room-${i}`,
              type: ChannelType.GuildVoice,
            });
            createdChannels.push(channel);
            console.log(`✅ Created channel: ${channel.name}`);
          }
          await interaction.safeSend({
            content: `Successfully created ${numRooms} breakout voice channels!`,
          });
        }
      } catch (error) {
        console.error(`❌ Error creating breakout rooms:`, error);
        await interaction.safeSend({
          content: "An error occurred while creating breakout rooms. Please ensure the bot has the necessary permissions!",
        });
      }
    }, { deferReply: true, ephemeral: true });
  },
};
