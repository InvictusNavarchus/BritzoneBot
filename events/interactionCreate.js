import { Events, MessageFlags, CommandInteraction } from 'discord.js';
import safeReply from '../helpers/safeReply.js';

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