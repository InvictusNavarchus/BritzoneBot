/**
 * Get all roles for a user
 * @param {import('discord.js').GuildMember} member - The guild member
 * @returns {import('discord.js').Collection} Collection of roles
 */
function getRoles(member) {
    console.log(`🏷️ Getting roles for user: ${member.user.tag}`);
    const roles = member.roles.cache;
    console.log(`🔖 Found ${roles.size} roles for ${member.user.tag}`);
    return roles;
}
  
export default getRoles;