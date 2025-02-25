import { ChannelType } from "discord.js";

/**
 * Creates a new voice channel
 * @param {import('discord.js').Guild|import('discord.js').CategoryChannel} parent - Guild or category to create channel in
 * @param {string} name - Name of the channel
 * @returns {Promise<import('discord.js').VoiceChannel>} The created channel
 */
async function createChannel(parent, name) {
  try {
    console.log(`📂 Creating voice channel: ${name}`);
    
    // If parent is a category, use its children.create method
    if ('children' in parent) {
      const channel = await parent.children.create({
        name,
        type: ChannelType.GuildVoice,
      });
      console.log(`✅ Created channel in category ${parent.name}: ${channel.name}`);
      return channel;
    }
    
    // Otherwise, create in guild
    const channel = await parent.channels.create({
      name,
      type: ChannelType.GuildVoice,
    });
    console.log(`✅ Created channel in guild: ${channel.name}`);
    return channel;
  } catch (error) {
    console.error(`❌ Failed to create channel ${name}:`, error);
    throw error;
  }
}

export default createChannel;
