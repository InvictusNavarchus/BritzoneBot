/**
 * Simple in-memory storage for tracking breakout rooms per guild
 */
class BreakoutRoomManager {
  constructor() {
    // Map structure: guildId -> { rooms: [channel objects], mainRoom: channelObject }
    this.sessions = new Map();
  }

  /**
   * Stores breakout rooms for a guild
   */
  storeRooms(guildId, rooms) {
    const session = this.sessions.get(guildId) || {};
    session.rooms = rooms;
    this.sessions.set(guildId, session);
    console.log(`📝 Stored ${rooms.length} breakout rooms for guild ${guildId}`);
  }

  /**
   * Sets the main room for a guild's breakout session
   */
  setMainRoom(guildId, mainRoom) {
    const session = this.sessions.get(guildId) || {};
    session.mainRoom = mainRoom;
    this.sessions.set(guildId, session);
    console.log(`📝 Set main room to ${mainRoom.name} for guild ${guildId}`);
  }

  /**
   * Gets the breakout rooms for a guild
   */
  getRooms(guildId) {
    const session = this.sessions.get(guildId);
    return session?.rooms || [];
  }

  /**
   * Gets the main room for a guild
   */
  getMainRoom(guildId) {
    const session = this.sessions.get(guildId);
    return session?.mainRoom;
  }

  /**
   * Clears session data for a guild
   */
  clearSession(guildId) {
    this.sessions.delete(guildId);
    console.log(`🧹 Cleared breakout session for guild ${guildId}`);
  }
}

// Export a singleton instance
export default new BreakoutRoomManager();
