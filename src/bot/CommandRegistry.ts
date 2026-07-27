import { MessageFlags } from "discord.js";
import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { SlashCommand } from "../core/SlashCommand";
import type { MusicServiceRegistry } from "../services/MusicServiceRegistry";
import type { VoiceGuard } from "../services/VoiceGuard";

/**
 * Indexes the slash commands by name and dispatches interactions to them. The
 * repetitive per-command boilerplate that used to wrap the giant switch —
 * resolving the guild member, fetching the guild's music service, and the outer
 * error reply — lives here once.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, SlashCommand>();

  constructor(
    commands: SlashCommand[],
    private readonly voice: VoiceGuard,
    private readonly music: MusicServiceRegistry,
  ) {
    for (const command of commands) {
      this.commands.set(command.data.name, command);
    }
  }

  /** JSON bodies for slash-command registration with Discord. */
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    return [...this.commands.values()].map((command) => command.data.toJSON());
  }

  async dispatch(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = await this.voice.resolveMember(interaction);
    if (!member) return;

    const command = this.commands.get(interaction.commandName);
    if (!command) return;

    const music = this.music.forGuild(interaction.guildId!);

    try {
      await command.execute({ interaction, member, music });
    } catch (error) {
      console.error("Command error:", error);
      const message = `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`;

      if (interaction.deferred) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}
