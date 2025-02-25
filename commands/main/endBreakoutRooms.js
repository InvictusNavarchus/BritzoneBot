import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";
import safeReply from "../../helpers/safeReply.js";

export default {
  data: new SlashCommandBuilder()
    .setName("end-breakout-rooms")
    .setDescription("Moves users back to the specified main voice channel and deletes breakout rooms")
    .addChannelOption((option) =>
      option
        .setName("main_room")
        .setDescription("Select the main voice channel where users should be moved back")
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    console.log(`🚀 End Breakout Rooms command initiated by ${interaction.user.tag}`);

    await safeReply(
      interaction,
      async () => {
        // Get the main voice channel from user input
        const mainChannel = interaction.options.getChannel("main_room");
        console.log(`🎯 Target main voice channel: ${mainChannel.name} (${mainChannel.id})`);

        // Identify all breakout rooms (voice channels with names starting with 'breakout-room-')
        const breakoutRooms = interaction.guild.channels.cache.filter(
          (channel) =>
            channel.type === ChannelType.GuildVoice && channel.name.startsWith("breakout-room-")
        );

        if (breakoutRooms.size === 0) {
          console.log(`⚠️ No breakout rooms found to end.`);
          await interaction.safeSend({
            content: "No breakout rooms found to end!",
          });
          return;
        }

        console.log(`🔍 Found ${breakoutRooms.size} breakout room(s) to process.`);

        let totalMoved = 0;
        // Iterate over each breakout room.
        for (const room of breakoutRooms.values()) {
          console.log(`📌 Processing breakout room: ${room.name} (${room.id})`);

          // Move each member in the breakout room back to the main channel.
          for (const [memberId, member] of room.members) {
            try {
              await member.voice.setChannel(mainChannel);
              console.log(`✅ Moved ${member.user.tag} from ${room.name} to ${mainChannel.name}`);
              totalMoved++;
            } catch (error) {
              console.error(`❌ Failed to move ${member.user.tag} from ${room.name}:`, error);
            }
          }

          // Delete the breakout room once its members have been moved.
          try {
            await room.delete("Breakout room ended and members moved back to main room");
            console.log(`🗑️ Deleted breakout room: ${room.name}`);
          } catch (error) {
            console.error(`❌ Failed to delete breakout room ${room.name}:`, error);
          }
        }

        console.log(`🎉 Successfully moved ${totalMoved} member(s) back to ${mainChannel.name} and deleted ${breakoutRooms.size} breakout room(s).`);

        await interaction.safeSend({
          content: `Successfully moved ${totalMoved} member(s) back to ${mainChannel.name} and deleted ${breakoutRooms.size} breakout room(s)!`,
        });
      },
      { deferReply: true, ephemeral: true }
    );
  },
};
