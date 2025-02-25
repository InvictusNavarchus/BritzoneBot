import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from "discord.js";
import safeReply from "../../helpers/safeReply.js";
import createChannel from "../../helpers/createChannel.js";
import isAdmin from "../../helpers/isAdmin.js";
import distributeUsers from "../../helpers/distributeUsers.js";
import moveUser from "../../helpers/moveUser.js";
import breakoutRoomManager from "../../helpers/breakoutRoomManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("breakout")
    .setDescription("Manage breakout rooms for your voice channels")
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
    // Create subcommand
    .addSubcommand(subcommand =>
      subcommand
        .setName("create")
        .setDescription("Creates multiple breakout voice channels")
        .addIntegerOption(option =>
          option
            .setName("number")
            .setDescription("Number of breakout rooms to create")
            .setMinValue(1)
            .setRequired(true)
        )
    )
    // Distribute subcommand
    .addSubcommand(subcommand =>
      subcommand
        .setName("distribute")
        .setDescription("Split members from a main room into breakout rooms")
        .addChannelOption(option =>
          option
            .setName("mainroom")
            .setDescription("The main voice channel where members are currently located")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        )
    )
    // End subcommand
    .addSubcommand(subcommand =>
      subcommand
        .setName("end")
        .setDescription("Moves users back to the main voice channel and deletes breakout rooms")
        .addChannelOption(option =>
          option
            .setName("main_room")
            .setDescription("The main voice channel where users should be moved back")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    console.log(`🚀 Breakout command initiated by ${interaction.user.tag}`);
    
    // Check if user has permission to use this command
    if (!isAdmin(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
      console.log(`🔒 Permission denied to ${interaction.user.tag} for breakout command`);
      return interaction.reply({ 
        content: 'You do not have permission to use this command.', 
        ephemeral: true 
      });
    }

    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === "create") {
      await handleCreateCommand(interaction);
    } else if (subcommand === "distribute") {
      await handleDistributeCommand(interaction);
    } else if (subcommand === "end") {
      await handleEndCommand(interaction);
    }
  },
};

/**
 * Handles the create subcommand
 */
async function handleCreateCommand(interaction) {
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

      // Store the created breakout rooms
      breakoutRoomManager.storeRooms(interaction.guildId, createdChannels);
      
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
  }, { deferReply: true, ephemeral: false });
}

/**
 * Handles the distribute subcommand
 */
async function handleDistributeCommand(interaction) {
  await safeReply(interaction, async () => {
    // Get the main room from options
    const mainRoom = interaction.options.getChannel('mainroom');
    console.log(`🎯 Main room selected: ${mainRoom.name}`);
    
    // Store the main room for future reference
    breakoutRoomManager.setMainRoom(interaction.guildId, mainRoom);
    
    // Get breakout rooms from the manager
    const breakoutRooms = breakoutRoomManager.getRooms(interaction.guildId);
    
    if (breakoutRooms.length === 0) {
      console.log(`❌ Error: No breakout rooms found`);
      return interaction.safeSend('No breakout rooms found! Please create breakout rooms first with `/breakout create`.');
    }
    
    // Get users in the main room
    console.log(`🔍 Getting users from main room: ${mainRoom.name}`);
    const usersInMainRoom = mainRoom.members;
    
    if (usersInMainRoom.size === 0) {
      console.log(`⚠️ No users found in ${mainRoom.name}`);
      return interaction.safeSend(`There are no users in ${mainRoom.name}.`);
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
      const usersInRoom = distribution[room.id]?.map(u => u.user.tag).join('\n') || 'No users assigned';
      embed.addFields({
        name: room.name,
        value: usersInRoom,
        inline: true
      });
      console.log(`📊 Added ${room.name} stats to embed: ${distribution[room.id]?.length || 0} users`);
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
    await interaction.safeSend({ embeds: [embed] });
  }, { deferReply: true, ephemeral: false });
}

/**
 * Handles the end subcommand
 */
async function handleEndCommand(interaction) {
  await safeReply(
    interaction,
    async () => {
      // Get the main voice channel from user input or from the manager
      let mainChannel = interaction.options.getChannel("main_room");
      
      // If no main channel is specified, try to get it from the manager
      if (!mainChannel) {
        mainChannel = breakoutRoomManager.getMainRoom(interaction.guildId);
        if (!mainChannel) {
          return interaction.safeSend({
            content: "Please specify a main voice channel where users should be moved back.",
          });
        }
      }
      
      console.log(`🎯 Target main voice channel: ${mainChannel.name} (${mainChannel.id})`);

      // Get tracked breakout rooms or identify them by name pattern
      let breakoutRooms = breakoutRoomManager.getRooms(interaction.guildId);
      
      // If no stored rooms, identify them by name pattern as fallback
      if (!breakoutRooms || breakoutRooms.length === 0) {
        breakoutRooms = interaction.guild.channels.cache.filter(
          (channel) =>
            channel.type === ChannelType.GuildVoice && channel.name.startsWith("breakout-room-")
        );
      }

      if (breakoutRooms.length === 0) {
        console.log(`⚠️ No breakout rooms found to end.`);
        return interaction.safeSend({
          content: "No breakout rooms found to end!",
        });
      }

      console.log(`🔍 Found ${breakoutRooms.length} breakout room(s) to process.`);

      let totalMoved = 0;
      // Iterate over each breakout room.
      for (const room of breakoutRooms) {
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

      // Clear the stored session data
      breakoutRoomManager.clearSession(interaction.guildId);

      console.log(`🎉 Successfully moved ${totalMoved} member(s) back to ${mainChannel.name} and deleted ${breakoutRooms.length} breakout room(s).`);

      await interaction.safeSend({
        content: `Successfully moved ${totalMoved} member(s) back to ${mainChannel.name} and deleted ${breakoutRooms.length} breakout room(s)!`,
      });
    },
    { deferReply: true, ephemeral: false }
  );
}
