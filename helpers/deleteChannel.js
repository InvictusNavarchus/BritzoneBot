/**
 * Safely deletes a voice channel
 * @param {import('discord.js').VoiceChannel} channel - The channel to delete
 * @param {string} reason - Reason for deletion
 * @returns {Promise<void>}
 */
async function deleteChannel(channel, reason = 'Channel cleanup') {
  try {
    console.log(`🗑️ Attempting to delete channel: ${channel.name}`);
    await channel.delete(reason);
    console.log(`✅ Successfully deleted channel: ${channel.name}`);
  } catch (error) {
    console.error(`❌ Failed to delete channel ${channel.name}:`, error);
    throw error;
  }
}

export default deleteChannel;
