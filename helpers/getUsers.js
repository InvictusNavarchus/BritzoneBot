/**
 * Get all users in a voice channel
 * @param {import('discord.js').VoiceChannel|import('discord.js').StageChannel} voiceChannel - The voice channel
 * @returns {import('discord.js').Collection} Collection of members in the voice channel
 */
function getUsers(voiceChannel) {
    console.log(`👥 Getting users from voice channel: ${voiceChannel.name}`);
    const users = voiceChannel.members;
    console.log(`📊 Found ${users.size} users in ${voiceChannel.name}`);
    return users;
}
  
export default getUsers;