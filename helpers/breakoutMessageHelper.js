import { TextChannel, VoiceChannel, Collection } from 'discord.js';
import breakoutRoomManager from './breakoutRoomManager.js';

/**
 * Broadcasts a message to all breakout rooms
 * @param {string} guildId - The ID of the guild
 * @param {string} message - The message to broadcast
 * @returns {Promise<{success: boolean, sent: string[], failed: string[], message: string}>}
 */
export async function broadcastToBreakoutRooms(guildId, message) {
    console.log(`📢 Broadcasting message to breakout rooms in guild ${guildId}`);
    const rooms = breakoutRoomManager.getRooms(guildId);
    
    if (!rooms || rooms.length === 0) {
        console.log('❌ No breakout rooms found for broadcasting');
        return {
            success: false,
            sent: [],
            failed: [],
            message: 'No breakout rooms found'
        };
    }

    const results = {
        sent: [],
        failed: []
    };

    for (const room of rooms) {
        try {
            await room.send(message);
            results.sent.push(room.name);
            console.log(`✅ Message sent to ${room.name}`);
        } catch (error) {
            console.error(`❌ Failed to send message to ${room.name}:`, error);
            results.failed.push(room.name);
        }
    }

    return {
        success: results.sent.length > 0,
        sent: results.sent,
        failed: results.failed,
        message: `Message broadcast complete. Success: ${results.sent.length}, Failed: ${results.failed.length}`
    };
}

/**
 * Sends a message to a specific voice channel
 * @param {VoiceChannel} channel - The voice channel to send the message to
 * @param {string} message - The message to send
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function sendMessageToChannel(channel, message) {
    console.log(`📨 Attempting to send message to channel ${channel.name}`);
    
    try {
        await channel.send(message);
        console.log(`✅ Message sent successfully to ${channel.name}`);
        return {
            success: true,
            message: `Message sent successfully to ${channel.name}`
        };
    } catch (error) {
        console.error(`❌ Failed to send message to ${channel.name}:`, error);
        return {
            success: false,
            message: `Failed to send message to ${channel.name}: ${error.message}`
        };
    }
}
