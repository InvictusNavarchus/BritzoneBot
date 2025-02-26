import { ChannelType } from "discord.js";
import stateManager from "./breakoutStateManager.js"; // adjust if necessary

export async function monitorBreakoutTimer(timerData, interaction) {
  const { totalMinutes, startTime, guildId, breakoutRooms } = timerData;
  const endTime = startTime + (totalMinutes * 60 * 1000);
  let timerState = await stateManager.getTimerData(guildId);
  
  console.log(`⏱️ Started breakout timer monitoring for ${totalMinutes} minutes in guild ${guildId}`);
  
  const intervalId = setInterval(async () => {
    try {
      timerState = await stateManager.getTimerData(guildId);
      if (!timerState) {
        console.log(`⏱️ Timer for guild ${guildId} was cancelled or removed`);
        clearInterval(intervalId);
        return;
      }
      
      const now = Date.now();
      const minutesLeft = Math.ceil((endTime - now) / (60 * 1000));
      
      if (minutesLeft <= 5 && !timerState.fiveMinSent) {
        console.log(`⏱️ Sending 5-minute warning to ${breakoutRooms.length} breakout rooms`);
        await sendReminderWithRetry(guildId, breakoutRooms,
          "⏱️ **5 minutes remaining** in this breakout session.", interaction.client);
        
        timerState.fiveMinSent = true;
        await stateManager.setTimerData(guildId, timerState);
      }
      
      if (minutesLeft <= 1 && !timerState.oneMinSent) {
        console.log(`⏱️ Sending 1-minute warning to ${breakoutRooms.length} breakout rooms`);
        await sendReminderWithRetry(guildId, breakoutRooms,
          "⏱️ **1 minute remaining** in this breakout session. Please wrap up your discussion.", interaction.client);
        
        timerState.oneMinSent = true;
        await stateManager.setTimerData(guildId, timerState);
      }
      
      if (now >= endTime) {
        console.log(`⏱️ Breakout timer ended for guild ${guildId}`);
        await sendReminderWithRetry(guildId, breakoutRooms,
          "⏰ **Time's up!** This breakout session has ended.", interaction.client);
        
        await stateManager.clearTimerData(guildId);
        clearInterval(intervalId);
      }
    } catch (error) {
      console.error(`❌ Error in timer monitoring:`, error);
    }
  }, 20000);
}

export async function sendReminderWithRetry(guildId, roomIds, message, client) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error(`❌ Could not find guild with ID ${guildId}`);
    return;
  }
  
  const maxRetries = 5;
  const retryDelay = 5000;
  
  for (const roomId of roomIds) {
    const voiceChannel = guild.channels.cache.get(roomId);
    if (!voiceChannel) {
      console.log(`⚠️ Could not find voice channel ${roomId}`);
      continue;
    }
    
    const textChannel = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildText &&
      c.name.toLowerCase().includes(voiceChannel.name.toLowerCase().replace(/\s+/g, '-'))
    );
    
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
