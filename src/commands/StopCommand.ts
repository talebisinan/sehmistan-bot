import { SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { VoiceGuard } from "../services/VoiceGuard";

/** `/stop` — stop playback and clear the entire queue. */
export class StopCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop playback and clear the entire queue");

  constructor(private readonly voice: VoiceGuard) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    if (!(await this.voice.requireVoiceChannel(interaction, member))) return;

    const stopped = music.stop();
    await interaction.reply(
      stopped ? "⏹️ Stopped and queue cleared!" : "❌ Nothing is playing!",
    );
  }
}
