import { SlashCommandBuilder, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import isAdmin from '../../helpers/isAdmin.js';
import getUsers from '../../helpers/getUsers.js';
import moveUser from '../../helpers/moveUser.js';
import distributeUsers from '../../helpers/distributeUsers.js';

export default {
  data: new SlashCommandBuilder()
    .setName('breakout')
    .setDescription('Split members from a main room into breakout rooms')
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
    .addChannelOption(option => 
      option.setName('mainroom')
        .setDescription('The main voice channel where members are currently located')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addChannelOption(option => 
      option.setName('breakoutroom1')
        .setDescription('First breakout room')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addChannelOption(option => 
      option.setName('breakoutroom2')
        .setDescription('Second breakout room')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addChannelOption(option => 
      option.setName('breakoutroom3')
        .setDescription('Third breakout room')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addChannelOption(option => 
      option.setName('breakoutroom4')
        .setDescription('Fourth breakout room')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addChannelOption(option => 
      option.setName('breakoutroom5')
        .setDescription('Fifth breakout room')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)),
        
  async execute(interaction) {
    console.log(`🚀 Breakout command initiated by ${interaction.user.tag}`);
    try {
      // Check if user has permission to use this command
      if (!isAdmin(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
        console.log(`🔒 Permission denied to ${interaction.user.tag} for breakout command`);
        return interaction.reply({ 
          content: 'You do not have permission to use this command.', 
          ephemeral: true 
        });
      }
      
      // Defer reply as this operation might take some time
      console.log(`⏳ Deferring reply for breakout command`);
      await interaction.deferReply();
      
      // Get the main room and breakout rooms from options
      const mainRoom = interaction.options.getChannel('mainroom');
      console.log(`🎯 Main room selected: ${mainRoom.name}`);
      
      // Collect all breakout rooms (filtering out null values)
      const breakoutRooms = [];
      for (let i = 1; i <= 5; i++) {
        const room = interaction.options.getChannel(`breakoutroom${i}`);
        if (room) {
          breakoutRooms.push(room);
          console.log(`🏢 Breakout room ${i} added: ${room.name}`);
        }
      }
      
      if (breakoutRooms.length === 0) {
        console.log(`❌ Error: No breakout rooms provided`);
        return interaction.editReply('You must provide at least one breakout room.');
      }
      
      // Get users in the main room
      console.log(`🔍 Getting users from main room: ${mainRoom.name}`);
      const usersInMainRoom = getUsers(mainRoom);
      
      if (usersInMainRoom.size === 0) {
        console.log(`⚠️ No users found in ${mainRoom.name}`);
        return interaction.editReply(`There are no users in ${mainRoom.name}.`);
      }
      
      // Distribute users among breakout rooms
      console.log(`🧩 Distributing ${usersInMainRoom.size} users among ${breakoutRooms.length} breakout rooms`);
      const distribution = distributeUsers(usersInMainRoom, breakoutRooms);
      
      // Move users to their assigned breakout rooms
      console.log(`🚚 Beginning user movement process`);
      const movePromises = [];
      const moveResults = {
        success: [],
        failed: []
      };
      
      for (const [roomId, users] of Object.entries(distribution)) {
        const room = breakoutRooms.find(r => r.id === roomId);
        console.log(`🔄 Processing moves for room: ${room.name} (${users.length} users)`);
        
        for (const user of users) {
          movePromises.push(
            moveUser(user, room)
              .then(() => {
                moveResults.success.push(`${user.user.tag} → ${room.name}`);
                console.log(`✅ Successfully moved ${user.user.tag} to ${room.name}`);
              })
              .catch(error => {
                moveResults.failed.push(`${user.user.tag} (${error.message})`);
                console.log(`❌ Failed to move ${user.user.tag}: ${error.message}`);
              })
          );
        }
      }
      
      // Wait for all moves to complete
      console.log(`⏳ Waiting for all ${movePromises.length} move operations to complete`);
      await Promise.all(movePromises);
      console.log(`✅ All move operations completed: ${moveResults.success.length} successful, ${moveResults.failed.length} failed`);
      
      // Create embed for nice formatting
      console.log(`📝 Creating response embed`);
      const embed = new EmbedBuilder()
        .setTitle('Breakout Room Assignment')
        .setColor('#00FF00')
        .setDescription(`Split users from ${mainRoom.name} into ${breakoutRooms.length} breakout rooms.`)
        .setTimestamp();
      
      // Add fields for each breakout room
      breakoutRooms.forEach(room => {
        const usersInRoom = distribution[room.id].map(u => u.user.tag).join('\n');
        embed.addFields({
          name: room.name,
          value: usersInRoom || 'No users assigned',
          inline: true
        });
        console.log(`📊 Added ${room.name} stats to embed: ${distribution[room.id].length} users`);
      });
      
      // Add error field if any
      if (moveResults.failed.length > 0) {
        embed.addFields({
          name: 'Failed Moves',
          value: moveResults.failed.join('\n'),
          inline: false
        });
        console.log(`⚠️ Added ${moveResults.failed.length} failed moves to embed`);
      }
      
      console.log(`📤 Sending breakout room results to Discord`);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(`❌ Error executing breakout command:`, error);
      if (interaction.deferred) {
        await interaction.editReply(`An error occurred: ${error.message}`);
      } else {
        await interaction.reply({ content: `An error occurred: ${error.message}`, ephemeral: true });
      }
    }
  },
};