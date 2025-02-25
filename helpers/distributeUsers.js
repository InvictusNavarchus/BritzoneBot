/**
 * Distribute users among breakout rooms
 * @param {Array<import('discord.js').GuildMember>} users - Array of users to distribute
 * @param {Array<import('discord.js').VoiceChannel|import('discord.js').StageChannel>} breakoutRooms - Array of breakout room channels
 * @returns {Object} Mapping of breakout room IDs to arrays of users
 */
function distributeUsers(users, breakoutRooms) {
    console.log(`🔄 Starting distribution of users among ${breakoutRooms.length} breakout rooms`);
    
    if (breakoutRooms.length === 0) {
      console.log(`❌ Distribution error: No breakout rooms provided`);
      throw new Error('No breakout rooms provided.');
    }
    
    const distribution = {};
    breakoutRooms.forEach(room => {
      distribution[room.id] = [];
      console.log(`🏗️ Created distribution bucket for room: ${room.name}`);
    });
    
    // Convert users collection to array if it's not already
    const userArray = Array.isArray(users) ? users : Array.from(users.values());
    console.log(`👤 Total users to distribute: ${userArray.length}`);
    
    // Shuffle users for randomness
    console.log(`🔀 Shuffling users for random distribution`);
    for (let i = userArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [userArray[i], userArray[j]] = [userArray[j], userArray[i]];
    }
    
    // Distribute users evenly
    console.log(`📋 Beginning user assignment to rooms`);
    userArray.forEach((user, index) => {
      const roomIndex = index % breakoutRooms.length;
      const roomId = breakoutRooms[roomIndex].id;
      const roomName = breakoutRooms[roomIndex].name;
      distribution[roomId].push(user);
      console.log(`➡️ Assigned ${user.user.tag} to room: ${roomName}`);
    });
    
    // Log the distribution summary
    Object.keys(distribution).forEach(roomId => {
      const room = breakoutRooms.find(r => r.id === roomId);
      console.log(`📊 Room ${room.name} has ${distribution[roomId].length} users assigned`);
    });
    
    return distribution;
}
  
export default distributeUsers;