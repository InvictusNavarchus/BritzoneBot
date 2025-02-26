import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, CommandInteraction } from "discord.js";
import safeReply from "../../helpers/safeReply.js";
import isAdmin from "../../helpers/isAdmin.js";
import distributeUsers from "../../helpers/distributeUsers.js";
import breakoutRoomManager from "../../helpers/breakoutRoomManager.js";
import { createBreakoutRooms, distributeToBreakoutRooms, endBreakoutSession } from "../../helpers/breakoutOperations.js";
import stateManager from "../../helpers/breakoutStateManager.js";

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
    
    // Calculate reminder times
    const fiveMinWarningTime = minutes - 5;
    const oneMinWarningTime = minutes - 1;
    
    // Set up the timer (converting minutes to milliseconds)
    const timerData = {
      totalMinutes: minutes,
      startTime: Date.now(),
      guildId: interaction.guildId,
      breakoutRooms: breakoutRooms.map(room => room.id),
      fiveMinSent: fiveMinWarningTime <= 0, // Skip if total time is less than 5 minutes
      oneMinSent: oneMinWarningTime <= 0,   // Skip if total time is less than 1 minute
    };
    
    // Store timer data in state manager
    await stateManager.setTimerData(interaction.guildId, timerData);
    
    // Start the timer monitoring process
    monitorBreakoutTimer(timerData, interaction);
    
    await interaction.safeSend({
      content: `⏱️ Breakout timer set for ${minutes} minutes. Reminders will be sent at 5 and 1 minute marks.`
    });
  }, { deferReply: true, ephemeral: false });
}

/**
 * Monitors a breakout timer and sends reminders at appropriate times
 * @param {Object} timerData - Timer data object with all necessary information
 * @param {CommandInteraction} interaction - The original Discord interaction
 */
async function monitorBreakoutTimer(timerData, interaction) {
  const { totalMinutes, startTime, guildId, breakoutRooms } = timerData;
  const endTime = startTime + (totalMinutes * 60 * 1000);
  let timerState = await stateManager.getTimerData(guildId);
  
  console.log(`⏱️ Started breakout timer monitoring for ${totalMinutes} minutes in guild ${guildId}`);
  
  // Timer monitoring interval (check every 20 seconds)
  const intervalId = setInterval(async () => {
    try {
      // Refresh timer state
      timerState = await stateManager.getTimerData(guildId);
      
      // If timer was cancelled or doesn't exist anymore
      if (!timerState) {
        console.log(`⏱️ Timer for guild ${guildId} was cancelled or removed`);
        clearInterval(intervalId);
        return;
      }
      
      const now = Date.now();
      const minutesLeft = Math.ceil((endTime - now) / (60 * 1000));
      
      // Check if we need to send the 5-minute warning
      if (minutesLeft <= 5 && !timerState.fiveMinSent) {
        console.log(`⏱️ Sending 5-minute warning to ${breakoutRooms.length} breakout rooms`);
        await sendReminderWithRetry(guildId, breakoutRooms, 
          "⏱️ **5 minutes remaining** in this breakout session.", interaction.client);
        
        // Update state to mark 5-minute warning as sent
        timerState.fiveMinSent = true;
        await stateManager.setTimerData(guildId, timerState);
      }
      
      // Check if we need to send the 1-minute warning
      if (minutesLeft <= 1 && !timerState.oneMinSent) {
        console.log(`⏱️ Sending 1-minute warning to ${breakoutRooms.length} breakout rooms`);
        await sendReminderWithRetry(guildId, breakoutRooms, 
          "⏱️ **1 minute remaining** in this breakout session. Please wrap up your discussion.", interaction.client);
        
        // Update state to mark 1-minute warning as sent
        timerState.oneMinSent = true;
        await stateManager.setTimerData(guildId, timerState);
      }
      
      // Check if timer has ended
      if (now >= endTime) {
        console.log(`⏱️ Breakout timer ended for guild ${guildId}`);
        await sendReminderWithRetry(guildId, breakoutRooms, 
          "⏰ **Time's up!** This breakout session has ended.", interaction.client);
        
        // Clean up timer state
        await stateManager.clearTimerData(guildId);
        clearInterval(intervalId);
      }
    } catch (error) {
      console.error(`❌ Error in timer monitoring:`, error);
    }
  }, 20000); // Check every 20 seconds
}

/**
 * Sends a reminder message to text channels associated with voice channels with retry logic
 * @param {string} guildId - The guild ID
 * @param {string[]} roomIds - Array of voice channel IDs
 * @param {string} message - The reminder message to send
 * @param {Client} client - Discord.js client
 * @returns {Promise<void>}
 */
async function sendReminderWithRetry(guildId, roomIds, message, client) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error(`❌ Could not find guild with ID ${guildId}`);
    return;
  }
  
  const maxRetries = 5;
  const retryDelay = 5000; // 5 seconds
  
  for (const roomId of roomIds) {
    const voiceChannel = guild.channels.cache.get(roomId);
    if (!voiceChannel) {
      console.log(`⚠️ Could not find voice channel ${roomId}`);
      continue;
    }
    
    // Find the text channel associated with this voice channel
    // Typically, text channels have similar names to voice channels
    const textChannel = guild.channels.cache.find(c => 
      c.type === ChannelType.GuildText && 
      c.name.toLowerCase().includes(voiceChannel.name.toLowerCase().replace(/\s+/g, '-')));
    
    if (!textChannel) {
      console.log(`⚠️ Could not find text channel for ${voiceChannel.name}`);
      continue;
    }
    
    let success = false;
    let attempts = 0;
    
    while (!success && attempts < maxRetries) {
      try {
        await textChannel.send(message);
        success = true;
        console.log(`✅ Reminder sent to ${textChannel.name}`);
      } catch (error) {
        attempts++;
        console.error(`❌ Attempt ${attempts}/${maxRetries} - Failed to send reminder to ${textChannel.name}:`, error);
        
        if (attempts < maxRetries) {
          console.log(`🔄 Retrying in ${retryDelay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    if (!success) {
      console.error(`❌ Failed to send reminder to ${textChannel.name} after ${maxRetries} attempts`);
    }
  }
}
