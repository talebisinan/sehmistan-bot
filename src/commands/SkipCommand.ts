import { SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { VoiceGuard } from "../services/VoiceGuard";

/** `/s` — skip the current song. */
export class SkipCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("s")
    .setDescription("Skip the current song");

  constructor(private readonly voice: VoiceGuard) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    if (!(await this.voice.requireVoiceChannel(interaction, member))) return;

    const skipped = music.skip();
    await interaction.reply(skipped ? "⏭️ Skipped!" : "❌ Nothing to skip!");
  }
}
