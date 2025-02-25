/**
 * Safely handles Discord interactions with built-in error handling for expired interactions
 * @param {import('discord.js').Interaction} interaction - The Discord interaction to handle
 * @param {Function} handler - Async function that handles the interaction
 * @param {Object} options - Options for handling the interaction
 * @param {boolean} options.deferReply - Whether to defer the reply before executing handler
 * @param {boolean} options.ephemeral - Whether the reply should be ephemeral
 */
async function safeReply(interaction, handler, options = {}) {
  const { deferReply = false, ephemeral = false } = options;
  
  try {
    // If deferReply is true, try to defer the reply first
    if (deferReply && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.deferReply({ ephemeral });
        console.log(`🔄 Successfully deferred interaction ${interaction.id}`);
      } catch (deferError) {
        // If we can't defer, the interaction likely expired
        if (deferError.code === 10062) {
          console.log(`⏱️ Interaction ${interaction.id} expired before deferring`);
          return false;
        }
        throw deferError; // Re-throw unexpected errors
      }
    }

    // Execute the handler function
    await handler();
    return true;
  } catch (error) {
    // Handle expired interactions gracefully
    if (error.code === 10062) {
      console.log(`⏱️ Interaction ${interaction.id} expired during handling`);
      return false;
    }
    
    // For other errors, try to report them if possible
    console.error(`❌ Error handling interaction:`, error);
    
    try {
      const errorMessage = 'There was an error while executing this command!';
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: errorMessage });
      } else if (!interaction.replied) {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      // If we can't reply, just log it - nothing more we can do
      console.error('Failed to send error response:', replyError);
    }
    
    return false;
  }
}

export default safeReply;
