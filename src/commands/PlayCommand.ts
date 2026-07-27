import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { MusicService } from "../services/MusicService";
import type { VoiceGuard } from "../services/VoiceGuard";
import { EMBED_COLOR } from "../shared/constants";

/** `/p <query>` — play a song (or playlist) from YouTube. */
export class PlayCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("p")
    .setDescription("Play a song from YouTube")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name or YouTube URL")
        .setRequired(true),
    );

  constructor(private readonly voice: VoiceGuard) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    const voiceChannel = await this.voice.requireVoiceChannel(
      interaction,
      member,
    );
    if (!voiceChannel) return;

    const query = interaction.options.getString("query", true);
    const requestedBy = member.user.username;

    await interaction.deferReply();

    const { title, duration, queued } = await music.play(
      voiceChannel,
      query,
      requestedBy,
    );

    await interaction.editReply({
      embeds: [this.buildEmbed(music, { title, duration, queued, requestedBy })],
    });
  }

  private buildEmbed(
    music: MusicService,
    result: {
      title: string;
      duration?: string;
      queued: number;
      requestedBy: string;
    },
  ): EmbedBuilder {
    const { title, duration, queued, requestedBy } = result;
    const isPlaylist = queued > 1;
    const isNowPlaying = music.getQueueLength() === 0 && !isPlaylist;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(
        isPlaylist
          ? "📋 Playlist Added"
          : isNowPlaying
            ? "▶️ Now Playing"
            : "➕ Added to Queue",
      )
      .setDescription(`**${title}**${isPlaylist ? ` and ${queued - 1} more` : ""}`)
      .setFooter({ text: `Requested by ${requestedBy}` });

    if (duration && !isPlaylist) {
      embed.addFields({ name: "⏱️ Duration", value: duration, inline: true });
    }

    if (isPlaylist) {
      embed.addFields({ name: "🎵 Songs", value: String(queued), inline: true });
    } else if (music.getQueueLength() > 0) {
      embed.addFields({
        name: "📝 Queue Position",
        value: `#${music.getQueueLength() + 1}`,
        inline: true,
      });
    }

    return embed;
  }
}
