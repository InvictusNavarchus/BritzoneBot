import { Events, MessageFlags } from 'discord.js';
import safeReply from '../helpers/safeReply.js';

// Helper to patch the interaction with a safeSend method
function patchInteraction(interaction) {
  // Add safeSend method that handles the interaction state
  interaction.safeSend = async function(options) {
    if (this.deferred || this.replied) {
      return this.editReply(options);
    } else {
      return this.reply(options);
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

    // Complex commands need deferReply (like breakout)
    const needsDefer = command.data.name === 'breakout';

    // Use safeReply helper with appropriate options
    await safeReply(interaction, async () => {
      await command.execute(interaction);
    }, { 
      deferReply: needsDefer,
      ephemeral: false
    });
  },
};