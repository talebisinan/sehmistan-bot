import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { VoiceGuard } from "../services/VoiceGuard";
import { formatDuration } from "../services/MusicService";
import { parseSeekPosition } from "../shared/format";

/** `/seek <position>` — seek to a position in the current song. */
export class SeekCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a position in the current song")
    .addStringOption((option) =>
      option
        .setName("position")
        .setDescription("Position to seek to (e.g. 1:30 or 90)")
        .setRequired(true),
    );

  constructor(private readonly voice: VoiceGuard) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    if (!(await this.voice.requireVoiceChannel(interaction, member))) return;

    const input = interaction.options.getString("position", true);
    const seconds = parseSeekPosition(input);

    if (seconds < 0) {
      await interaction.reply({
        content: "❌ Invalid position. Use `1:30` or `90` (seconds).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!music.seek(seconds)) {
      await interaction.reply({
        content: "❌ Nothing is playing right now!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(`⏩ Seeking to **${formatDuration(seconds)}**...`);
  }
}
