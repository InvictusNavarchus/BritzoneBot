import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from "discord.js";
import safeReply from "../../helpers/safeReply.js";
import isAdmin from "../../helpers/isAdmin.js";
import distributeUsers from "../../helpers/distributeUsers.js";
import breakoutRoomManager from "../../helpers/breakoutRoomManager.js";
import { createBreakoutRooms, distributeToBreakoutRooms, endBreakoutSession } from "../../helpers/breakoutOperations.js";
import stateManager from "../../helpers/breakoutStateManager.js";

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
    
    // Check for interrupted operations first
    const inProgress = await stateManager.hasOperationInProgress(interaction.guildId);
    if (inProgress) {
      const currentOp = await stateManager.getCurrentOperation(interaction.guildId);
      console.log(`⚠️ Found interrupted ${currentOp.type} operation for guild ${interaction.guildId}`);
      
      await interaction.reply({ 
        content: `Found an interrupted breakout operation. Attempting to resume the previous '${currentOp.type}' command...`, 
        ephemeral: true 
      });
    }
    
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
      const result = await createBreakoutRooms(interaction, numRooms);
      
      if (result.success) {
        await interaction.safeSend({
          content: result.message,
        });
      } else {
        console.error(`❌ Error creating breakout rooms:`, result.error);
        await interaction.safeSend({
          content: result.message,
        });
      }
    } catch (error) {
      console.error(`❌ Error in handleCreateCommand:`, error);
      await interaction.safeSend({
        content: "An unexpected error occurred while creating breakout rooms. Please try again later.",
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
    
    // Use the recovery-compatible distribute function
    const result = await distributeToBreakoutRooms(interaction, mainRoom, distribution);
    
    if (!result.success) {
      return interaction.safeSend({
        content: result.message
      });
    }
    
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
    if (result.moveResults.failed && result.moveResults.failed.length > 0) {
      embed.addFields({
        name: 'Failed Moves',
        value: result.moveResults.failed.join('\n'),
        inline: false
      });
      console.log(`⚠️ Added ${result.moveResults.failed.length} failed moves to embed`);
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
      
      const result = await endBreakoutSession(interaction, mainChannel);
      
      if (result.success) {
        await interaction.safeSend({
          content: result.message
        });
      } else {
        await interaction.safeSend({
          content: result.message || "Failed to end breakout session."
        });
      }
    },
    { deferReply: true, ephemeral: false }
  );
}
