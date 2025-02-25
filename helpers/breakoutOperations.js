import { ChannelType } from 'discord.js';
import breakoutRoomManager from './breakoutRoomManager.js';
import stateManager from './breakoutStateManager.js';
import createChannel from './createChannel.js';
import moveUser from './moveUser.js';

/**
 * Create breakout rooms with checkpointing
 */
export async function createBreakoutRooms(interaction, numRooms) {
  const guildId = interaction.guildId;
  const operationType = 'create';
  
  // Check if there's an operation in progress
  const inProgress = await stateManager.hasOperationInProgress(guildId);
  if (inProgress) {
    return await resumeOperation(interaction);
  }
  
  // Start new operation
  await stateManager.startOperation(guildId, operationType, { numRooms });
  
  try {
    const createdChannels = [];
    const parent = interaction.channel.parent || interaction.guild;
    
    // Create each breakout room with checkpointing
    for (let i = 1; i <= numRooms; i++) {
      const roomName = `breakout-room-${i}`;
      
      // Check if this step was already completed in a previous attempt
      const steps = await stateManager.getCompletedSteps(guildId);
      if (steps[`create_room_${i}`]) {
        console.log(`⏭️ Room ${roomName} was already created, skipping`);
        
        // Try to find the existing channel
        const existingChannel = interaction.guild.channels.cache.find(
          c => c.name === roomName && c.type === ChannelType.GuildVoice
        );
        
        if (existingChannel) {
          createdChannels.push(existingChannel);
          continue;
        }
      }
      
      console.log(`📂 Creating voice channel: ${roomName}`);
      try {
        const channel = await createChannel(parent, roomName);
        createdChannels.push(channel);
        await stateManager.updateProgress(guildId, `create_room_${i}`, { channelId: channel.id });
      } catch (error) {
        console.error(`❌ Failed to create ${roomName}:`, error);
        throw error;
      }
    }
    
    // Store the created breakout rooms
    await stateManager.updateProgress(guildId, 'store_rooms', { roomIds: createdChannels.map(c => c.id) });
    breakoutRoomManager.storeRooms(guildId, createdChannels);
    
    // Complete operation
    await stateManager.completeOperation(guildId);
    
    return {
      success: true,
      message: `Successfully created ${numRooms} breakout voice channels${
        interaction.channel.parent ? ' in the same category' : ''
      }!`,
      rooms: createdChannels
    };
  } catch (error) {
    console.error(`❌ Error in createBreakoutRooms:`, error);
    return {
      success: false,
      message: "An error occurred while creating breakout rooms. You can try running the command again to resume the process.",
      error
    };
  }
}

/**
 * Distribute users to breakout rooms with checkpointing
 */
export async function distributeToBreakoutRooms(interaction, mainRoom, distribution) {
  const guildId = interaction.guildId;
  const operationType = 'distribute';
  
  // Check if there's an operation in progress
  const inProgress = await stateManager.hasOperationInProgress(guildId);
  if (inProgress) {
    return await resumeOperation(interaction);
  }
  
  // Store distribution plan for recovery
  const distributionPlan = {};
  for (const [roomId, users] of Object.entries(distribution)) {
    distributionPlan[roomId] = users.map(user => user.id);
  }
  
  // Start new operation
  await stateManager.startOperation(guildId, operationType, {
    mainRoomId: mainRoom.id,
    distribution: distributionPlan
  });
  
  try {
    // Store the main room for future reference
    await stateManager.updateProgress(guildId, 'set_main_room');
    breakoutRoomManager.setMainRoom(guildId, mainRoom);
    
    const movePromises = [];
    const moveResults = {
      success: [],
      failed: []
    };
    
    // Process each room
    for (const [roomId, users] of Object.entries(distribution)) {
      const room = interaction.guild.channels.cache.get(roomId);
      
      if (!room) {
        console.log(`⚠️ Room ${roomId} not found, skipping users`);
        continue;
      }
      
      console.log(`🔄 Processing moves for room: ${room.name} (${users.length} users)`);
      
      // Check which users were already moved in a previous attempt
      const steps = await stateManager.getCompletedSteps(guildId);
      
      for (const user of users) {
        const moveKey = `move_user_${user.id}_to_${roomId}`;
        
        if (steps[moveKey]) {
          console.log(`⏭️ User ${user.user.tag} was already moved to ${room.name}, skipping`);
          moveResults.success.push(`${user.user.tag} → ${room.name}`);
          continue;
        }
        
        console.log(`🚚 Attempting to move ${user.user.tag} to channel: ${room.name}`);
        
        movePromises.push(
          moveUser(user, room)
            .then(async () => {
              moveResults.success.push(`${user.user.tag} → ${room.name}`);
              console.log(`✅ Successfully moved ${user.user.tag} to ${room.name}`);
              await stateManager.updateProgress(guildId, moveKey);
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
    
    // Mark distribution as complete
    await stateManager.updateProgress(guildId, 'distribution_complete', {
      successful: moveResults.success.length,
      failed: moveResults.failed.length
    });
    
    // Complete operation
    await stateManager.completeOperation(guildId);
    
    return {
      success: true,
      moveResults,
      distribution
    };
  } catch (error) {
    console.error(`❌ Error in distributeToBreakoutRooms:`, error);
    return {
      success: false,
      message: "An error occurred while distributing users. You can try running the command again to resume the process.",
      error
    };
  }
}

/**
 * End breakout sessions with checkpointing
 */
export async function endBreakoutSession(interaction, mainChannel) {
  const guildId = interaction.guildId;
  const operationType = 'end';
  
  // Check if there's an operation in progress
  const inProgress = await stateManager.hasOperationInProgress(guildId);
  if (inProgress) {
    return await resumeOperation(interaction);
  }
  
  // Get breakout rooms
  let breakoutRooms = breakoutRoomManager.getRooms(guildId);
  
  // If no stored rooms, identify them by name pattern as fallback
  if (!breakoutRooms || breakoutRooms.length === 0) {
    breakoutRooms = interaction.guild.channels.cache.filter(
      (channel) =>
        channel.type === ChannelType.GuildVoice && 
        channel.name.startsWith("breakout-room-")
    ).toArray();
  }
  
  if (breakoutRooms.length === 0) {
    console.log(`⚠️ No breakout rooms found to end.`);
    return {
      success: false,
      message: "No breakout rooms found to end!"
    };
  }
  
  // Start new operation
  await stateManager.startOperation(guildId, operationType, {
    mainRoomId: mainChannel.id,
    roomIds: breakoutRooms.map(room => room.id)
  });
  
  console.log(`🔍 Found ${breakoutRooms.length} breakout room(s) to process.`);
  
  let totalMoved = 0;
  let totalRooms = breakoutRooms.length;
  let deletedRooms = 0;
  
  try {
    // Process each room one by one with checkpoints
    for (const room of breakoutRooms) {
      if (!room) continue;

      console.log(`📌 Processing breakout room: ${room.name} (${room.id})`);
      
      // Check if we already processed this room
      const steps = await stateManager.getCompletedSteps(guildId);
      const roomProcessedKey = `room_processed_${room.id}`;
      
      if (steps[roomProcessedKey]) {
        console.log(`⏭️ Room ${room.name} was already processed, skipping`);
        deletedRooms++;
        continue;
      }
      
      // Move members first
      try {
        // Check if the room still exists in the guild
        const guildRoom = interaction.guild.channels.cache.get(room.id);
        if (!guildRoom) {
          console.log(`⚠️ Room ${room.name} (${room.id}) no longer exists, skipping`);
          await stateManager.updateProgress(guildId, roomProcessedKey, { skipped: true });
          deletedRooms++; // Count as deleted since it doesn't exist anymore
          continue;
        }
        
        // Move each member
        if (guildRoom.members && guildRoom.members.size > 0) {
          for (const [memberId, member] of guildRoom.members) {
            const memberMovedKey = `member_moved_${memberId}_from_${room.id}`;
            
            if (steps[memberMovedKey]) {
              console.log(`⏭️ Member ${member.user.tag} was already moved, skipping`);
              totalMoved++;
              continue;
            }
            
            try {
              await member.voice.setChannel(mainChannel);
              console.log(`✅ Moved ${member.user.tag} from ${room.name} to ${mainChannel.name}`);
              await stateManager.updateProgress(guildId, memberMovedKey);
              totalMoved++;
            } catch (error) {
              console.error(`❌ Failed to move ${member.user.tag} from ${room.name}:`, error);
            }
          }
        }
        
        // Then delete the room
        const roomDeletedKey = `room_deleted_${room.id}`;
        if (!steps[roomDeletedKey]) {
          try {
            await guildRoom.delete("Breakout room ended and members moved back to main room");
            console.log(`🗑️ Deleted breakout room: ${room.name}`);
            await stateManager.updateProgress(guildId, roomDeletedKey);
            deletedRooms++;
          } catch (error) {
            console.error(`❌ Failed to delete breakout room ${room.name}:`, error);
          }
        } else {
          console.log(`⏭️ Room ${room.name} was already deleted, skipping`);
          deletedRooms++;
        }
        
        // Mark this room as fully processed
        await stateManager.updateProgress(guildId, roomProcessedKey);
      } catch (error) {
        console.error(`❌ Error processing room ${room.name}:`, error);
        // Continue with other rooms even if one fails
      }
    }
    
    // Clear the stored session data
    await stateManager.updateProgress(guildId, 'clear_session');
    breakoutRoomManager.clearSession(guildId);
    
    // Complete operation
    await stateManager.completeOperation(guildId);
    
    console.log(`🎉 Successfully moved ${totalMoved} member(s) back to ${mainChannel.name} and deleted ${deletedRooms}/${totalRooms} breakout room(s).`);
    
    return {
      success: true,
      message: `Successfully moved ${totalMoved} member(s) back to ${mainChannel.name} and deleted ${deletedRooms}/${totalRooms} breakout room(s)!`,
      totalMoved,
      deletedRooms,
      totalRooms
    };
  } catch (error) {
    console.error(`❌ Error in endBreakoutSession:`, error);
    return {
      success: false,
      message: "An error occurred while ending the breakout session. You can try running the command again to resume the process.",
      error
    };
  }
}

/**
 * Resume an in-progress operation
 */
async function resumeOperation(interaction) {
  const guildId = interaction.guildId;
  const currentOp = await stateManager.getCurrentOperation(guildId);
  
  if (!currentOp) {
    return {
      success: false,
      message: "There was a problem resuming the previous operation. Please try starting a new command."
    };
  }
  
  console.log(`🔁 Resuming ${currentOp.type} operation for guild ${guildId}`);
  
  switch (currentOp.type) {
    case 'create':
      // For create, just restart with the same params
      return await createBreakoutRooms(interaction, currentOp.params.numRooms);
      
    case 'distribute':
      // For distribute, we need to reconstruct the distribution
      const mainRoom = interaction.guild.channels.cache.get(currentOp.params.mainRoomId);
      if (!mainRoom) {
        await stateManager.completeOperation(guildId);
        return {
          success: false,
          message: "Could not find the main room from the previous distribute operation."
        };
      }
      
      // Reconstruct distribution from stored plan
      const distribution = {};
      for (const [roomId, userIds] of Object.entries(currentOp.params.distribution)) {
        distribution[roomId] = userIds.map(id => 
          interaction.guild.members.cache.get(id)
        ).filter(Boolean);
      }
      
      return await distributeToBreakoutRooms(interaction, mainRoom, distribution);
      
    case 'end':
      // For end, just restart with the same main channel
      const mainChannel = interaction.guild.channels.cache.get(currentOp.params.mainRoomId);
      if (!mainChannel) {
        await stateManager.completeOperation(guildId);
        return {
          success: false,
          message: "Could not find the main room from the previous end operation."
        };
      }
      
      return await endBreakoutSession(interaction, mainChannel);
      
    default:
      await stateManager.completeOperation(guildId);
      return {
        success: false,
        message: "Unknown operation type found. Starting fresh."
      };
  }
}
