import { Events, MessageFlags } from 'discord.js';
import safeReply from '../helpers/safeReply.js';

// Helper to patch the interaction with a safeSend method
function patchInteraction(interaction) {
  // Add safeSend method that handles the interaction state
  interaction.safeSend = async function(options) {
    try {
      if (this.deferred || this.replied) {
        return this.editReply(options);
      } else {
        return this.reply(options);
      }
    } catch (error) {
      if (error.code === 10062) {
        console.log(`⏱️ Interaction ${this.id} expired while trying to send a response`);
        return null;
      }
      if (error.code === 'EAI_AGAIN') {
        console.log(`🌐 Network issue while responding to interaction ${this.id}: ${error.message}`);
        return null;
      }
      throw error;
    }
  };
  return interaction;
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    // Enhance the interaction with our safeSend method
    patchInteraction(interaction);

    // Determine if the command is complex and should be deferred
    // Almost all commands that make API requests should be deferred
    const needsDefer = ['breakout', 'create-breakout-rooms', 'end-breakout-rooms'].includes(command.data.name);

    // Use safeReply helper with appropriate options
    await safeReply(interaction, async () => {
      await command.execute(interaction);
    }, { 
      deferReply: needsDefer,
      ephemeral: false
    });
  },
};