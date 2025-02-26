import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, CommandInteraction } from "discord.js";
import safeReply from "../../helpers/safeReply.js";
import isAdmin from "../../helpers/isAdmin.js";
import distributeUsers from "../../helpers/distributeUsers.js";
import breakoutRoomManager from "../../helpers/breakoutRoomManager.js";
import { createBreakoutRooms, distributeToBreakoutRooms, endBreakoutSession } from "../../helpers/breakoutOperations.js";
import stateManager from "../../helpers/breakoutStateManager.js";
import { monitorBreakoutTimer } from "../../helpers/breakoutTimerHelper.js"; // new import
import { broadcastToBreakoutRooms, sendMessageToChannel } from "../../helpers/messageHelpers.js"; // new import

/**
 * @typedef {Object} OperationResult
 * @property {boolean} success - Whether the operation succeeded
 * @property {string} message - Result message
 * @property {Object} [moveResults] - Optional results from move operations
 * @property {string[]} [moveResults.failed] - Array of failed move operations
 */

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
        .addStringOption(option =>
          option
            .setName("facilitators")
            .setDescription("Users to keep in the main room (mention them with @)")
            .setRequired(false)
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
    )
    // Timer subcommand - new addition
    .addSubcommand(subcommand =>
      subcommand
        .setName("timer")
        .setDescription("Sets a timer for the breakout session")
        .addIntegerOption(option =>
          option
            .setName("minutes")
            .setDescription("Duration of the breakout session in minutes")
            .setMinValue(1)
            .setRequired(true)
        )
    )
    // Broadcast subcommand - new addition
    .addSubcommand(subcommand =>
      subcommand
        .setName('broadcast')
        .setDescription('Broadcasts a message to all breakout rooms')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('The message to broadcast')
            .setRequired(true)
        )
    )
    // Send-message subcommand - new addition
    .addSubcommand(subcommand =>
      subcommand
        .setName('send-message')
        .setDescription('Sends a message to a specific voice channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('The voice channel to send the message to')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('The message to send')
            .setRequired(true)
        )
    ),

  /**
   * Executes the breakout command
   * @param {CommandInteraction} interaction - The Discord interaction
   * @returns {Promise<void>}
   */
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
    } else if (subcommand === "timer") {
      await handleTimerCommand(interaction);
    } else if (subcommand === "broadcast") {
      await handleBroadcastCommand(interaction);
    } else if (subcommand === "send-message") {
      await handleSendMessageCommand(interaction);
    }
  },
};

/**
 * Handles the create subcommand for breakout rooms
 * @param {CommandInteraction} interaction - The Discord interaction
 * @returns {Promise<void>}
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
 * Handles the distribute subcommand for breakout rooms
 * @param {CommandInteraction} interaction - The Discord interaction
 * @returns {Promise<void>}
 */
async function handleDistributeCommand(interaction) {
  await safeReply(interaction, async () => {
    const mainRoom = interaction.options.getChannel('mainroom');
    const facilitatorsInput = interaction.options.getString('facilitators');
    console.log(`🎯 Main room selected: ${mainRoom.name}`);
    
    // Process facilitators if provided
    const facilitators = new Set();
    if (facilitatorsInput) {
      const mentionPattern = /<@!?(\d+)>/g;
      const matches = facilitatorsInput.matchAll(mentionPattern);
      for (const match of matches) {
        facilitators.add(match[1]);
      }
      console.log(`👥 Facilitators identified: ${facilitators.size}`);
    }

    const breakoutRooms = breakoutRoomManager.getRooms(interaction.guildId);
    
    if (breakoutRooms.length === 0) {
      console.log(`❌ Error: No breakout rooms found`);
      return interaction.safeSend('No breakout rooms found! Please create breakout rooms first with `/breakout create`.');
    }
    
    const usersInMainRoom = mainRoom.members;
    
    if (usersInMainRoom.size === 0) {
      console.log(`⚠️ No users found in ${mainRoom.name}`);
      return interaction.safeSend(`There are no users in ${mainRoom.name}.`);
    }

    // Filter out facilitators before distribution
    const usersToDistribute = Array.from(usersInMainRoom.values())
      .filter(member => !facilitators.has(member.user.id));
    
    console.log(`🧩 Distributing ${usersToDistribute.length} users among ${breakoutRooms.length} breakout rooms (excluding ${facilitators.size} facilitators)`);
    const distribution = distributeUsers(usersToDistribute, breakoutRooms);
    
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
    
    // Add facilitators field if any exist
    if (facilitators.size > 0) {
      const facilitatorUsers = Array.from(usersInMainRoom.values())
        .filter(member => facilitators.has(member.user.id))
        .map(member => member.user.tag)
        .join('\n');
      
      embed.addFields({
        name: '👥 Facilitators',
        value: facilitatorUsers || 'None',
        inline: false
      });
      console.log(`📊 Added ${facilitators.size} facilitators to embed`);
    }
    
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
 * Handles the end subcommand for breakout rooms
 * @param {CommandInteraction} interaction - The Discord interaction
 * @returns {Promise<void>}
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

/**
 * Handles the timer subcommand for breakout rooms
 * @param {CommandInteraction} interaction - The Discord interaction
 * @returns {Promise<void>}
 */
async function handleTimerCommand(interaction) {
  await safeReply(interaction, async () => {
    const minutes = interaction.options.getInteger("minutes");
    console.log(`⏱️ Setting breakout timer for ${minutes} minutes`);
    
    const breakoutRooms = breakoutRoomManager.getRooms(interaction.guildId);
    
    if (breakoutRooms.length === 0) {
      console.log(`❌ Error: No breakout rooms found`);
      return interaction.safeSend('No breakout rooms found! Please create breakout rooms first with `/breakout create`.');
    }
    
    // Calculate reminder time
    const fiveMinWarningTime = minutes - 5;
    
    // Set up the timer data (converting minutes to milliseconds)
    const timerData = {
      totalMinutes: minutes,
      startTime: Date.now(),
      guildId: interaction.guildId,
      breakoutRooms: breakoutRooms.map(room => room.id),
      fiveMinSent: fiveMinWarningTime <= 0, // Skip if total time is less than 5 minutes
    };
    
    // Store timer data in state manager
    await stateManager.setTimerData(interaction.guildId, timerData);
    
    // Start the timer monitoring process
    monitorBreakoutTimer(timerData, interaction);
    
    await interaction.safeSend({
      content: `⏱️ Breakout timer set for ${minutes} minutes. Reminder will be sent at 5 minute mark.`
    });
  }, { deferReply: true, ephemeral: false });
}

/**
 * Handles the broadcast subcommand
 * @param {CommandInteraction} interaction - The Discord interaction
 * @returns {Promise<void>}
 */
async function handleBroadcastCommand(interaction) {
  await safeReply(interaction, async () => {
    const message = interaction.options.getString('message');
    console.log(`📢 Broadcasting message: "${message}"`);

    const result = await broadcastToBreakoutRooms(interaction.guildId, message);

    if (result.success) {
      const embed = new EmbedBuilder()
        .setTitle('Broadcast Results')
        .setColor('#00FF00')
        .setDescription('Message broadcast complete')
        .addFields(
          { name: 'Successfully Sent To', value: result.sent.join('\n') || 'None', inline: true }
        );

      if (result.failed.length > 0) {
        embed.addFields(
          { name: 'Failed To Send To', value: result.failed.join('\n'), inline: true }
        );
      }

      await interaction.safeSend({ embeds: [embed] });
    } else {
      await interaction.safeSend({
        content: result.message
      });
    }
  }, { deferReply: true, ephemeral: false });
}

/**
 * Handles the send-message subcommand
 * @param {CommandInteraction} interaction - The Discord interaction
 * @returns {Promise<void>}
 */
async function handleSendMessageCommand(interaction) {
  await safeReply(interaction, async () => {
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    
    console.log(`📨 Sending message to ${channel.name}: "${message}"`);

    const result = await sendMessageToChannel(channel, message);

    await interaction.safeSend({
      content: result.message,
      ephemeral: !result.success
    });
  }, { deferReply: true, ephemeral: false });
}
