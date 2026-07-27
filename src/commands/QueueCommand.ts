import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import { EMBED_COLOR } from "../shared/constants";

/** `/q` — show the now-playing song and the upcoming queue. */
export class QueueCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("q")
    .setDescription("Show the current music queue");

  async execute({ interaction, music }: CommandContext): Promise<void> {
    const currentSong = music.getCurrentSong();
    const queue = music.getQueue();

    if (!currentSong && queue.length === 0) {
      await interaction.reply({
        content: "📭 The queue is empty!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🎵 Music Queue");

    if (currentSong) {
      const titlePart = currentSong.duration
        ? `**[${currentSong.title}](${currentSong.url})** \`${currentSong.duration}\``
        : `**[${currentSong.title}](${currentSong.url})**`;
      embed.addFields({
        name: "▶️ Now Playing",
        value: `${titlePart}\nRequested by **${currentSong.requestedBy}**`,
      });
    }

    if (queue.length > 0) {
      const lines = queue.slice(0, 10).map((song, i) => {
        const durationPart = song.duration ? ` \`${song.duration}\`` : "";
        return `**${i + 1}.** ${song.title}${durationPart} — *${song.requestedBy}*`;
      });

      if (queue.length > 10) {
        lines.push(`*...and ${queue.length - 10} more songs*`);
      }

      embed.addFields({
        name: `📋 Up Next — ${queue.length} song(s)`,
        value: lines.join("\n"),
      });
    }

    await interaction.reply({ embeds: [embed] });
  }
}
