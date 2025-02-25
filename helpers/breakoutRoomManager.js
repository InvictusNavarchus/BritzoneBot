/**
 * @typedef {Object} BreakoutSession
 * @property {import('discord.js').VoiceChannel[]} rooms - Array of breakout room channels
 * @property {import('discord.js').VoiceChannel} mainRoom - The main voice channel
 */

/**
 * Manages breakout room sessions for Discord guilds
 */
class BreakoutRoomManager {
  constructor() {
    /** @type {Map<string, BreakoutSession>} */
    this.sessions = new Map();
  }

  /**
   * Stores breakout rooms for a guild
   * @param {string} guildId - The Discord guild ID
   * @param {import('discord.js').VoiceChannel[]} rooms - Array of voice channels
   */
  storeRooms(guildId, rooms) {
    const session = this.sessions.get(guildId) || {};
    session.rooms = rooms;
    this.sessions.set(guildId, session);
    console.log(`📝 Stored ${rooms.length} breakout rooms for guild ${guildId}`);
  }

  /**
   * Sets the main room for a guild's breakout session
   * @param {string} guildId - The Discord guild ID
   * @param {import('discord.js').VoiceChannel} mainRoom - The main voice channel
   */
  setMainRoom(guildId, mainRoom) {
    const session = this.sessions.get(guildId) || {};
    session.mainRoom = mainRoom;
    this.sessions.set(guildId, session);
    console.log(`📝 Set main room to ${mainRoom.name} for guild ${guildId}`);
  }

  /**
   * Gets the breakout rooms for a guild
   * @param {string} guildId - The Discord guild ID
   * @returns {import('discord.js').VoiceChannel[]} Array of voice channels or empty array
   */
  getRooms(guildId) {
    const session = this.sessions.get(guildId);
    return session?.rooms || [];
  }

  /**
   * Gets the main room for a guild
   * @param {string} guildId - The Discord guild ID
   * @returns {import('discord.js').VoiceChannel|undefined} The main voice channel or undefined
   */
  getMainRoom(guildId) {
    const session = this.sessions.get(guildId);
    return session?.mainRoom;
  }

  /**
   * Clears session data for a guild
   * @param {string} guildId - The Discord guild ID
   */
  clearSession(guildId) {
    this.sessions.delete(guildId);
    console.log(`🧹 Cleared breakout session for guild ${guildId}`);
  }
}

// Export a singleton instance
export default new BreakoutRoomManager();
