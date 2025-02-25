import { Events, MessageFlags, CommandInteraction } from 'discord.js';
import safeReply from '../helpers/safeReply.js';

/**
 * Enhances an interaction with a safeSend method
 * @param {CommandInteraction} interaction - The Discord interaction to patch
 * @returns {CommandInteraction & { safeSend: Function }} The enhanced interaction
 */
function patchInteraction(interaction) {
  /**
   * Safely sends a response to the interaction
   * @param {import('discord.js').InteractionReplyOptions} options - The reply options
   * @returns {Promise<import('discord.js').Message|import('discord.js').InteractionResponse|null>}
   */
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
  /**
   * Handles incoming interactions
   * @param {CommandInteraction} interaction - The Discord interaction
   */
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    // Log command execution with details
    const options = interaction.options.data.map(opt => {
      const value = opt.value;
      // Handle subcommands and subcommand groups
      if (opt.type === 1 || opt.type === 2) {
        return `${opt.name}[${opt.options?.map(o => `${o.name}=${o.value}`).join(', ')}]`;
      }
      return `${opt.name}=${value}`;
    });

    console.log(`🔵 Command executed:
    User: ${interaction.user.tag} (${interaction.user.id})
    Guild: ${interaction.guild?.name} (${interaction.guild?.id})
    Command: /${interaction.commandName}
    Options: ${options.length ? options.join(', ') : 'none'}
    Channel: ${interaction.channel?.name} (${interaction.channel?.id})`);

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