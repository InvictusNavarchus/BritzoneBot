import getRoles from './getRoles';

/**
 * Check if a user has admin privileges
 * @param {import('discord.js').GuildMember} member - The guild member
 * @param {string} adminRoleName - The name of the admin role (default: 'Admin')
 * @returns {boolean} Whether the user has admin privileges
 */

function isAdmin(member, adminRoleName = 'Admin') {
  // Check if the user has administrator permission
  if (member.permissions.has('Administrator')) {
    return true;
  }
  
  // Check if the user has the specified admin role
  const roles = getRoles(member);
  return roles.some(role => role.name === adminRoleName);
}

export default isAdmin;