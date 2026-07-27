import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { VoiceGuard } from "../services/VoiceGuard";
import { EMBED_COLOR } from "../shared/constants";
import { buildQueueJumpRow } from "../shared/queueJump";

/**
 * `/radio [query]` — start a YouTube radio/mix seeded from a query or the
 * current song. Presents a queue-jump dropdown over the queued tracks.
 */
export class RadioCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("radio")
    .setDescription(
      "Start a YouTube radio/mix based on the current song or a query",
    )
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription(
          "Song name or YouTube URL to seed the radio (optional — defaults to current song)",
        )
        .setRequired(false),
    );

  constructor(private readonly voice: VoiceGuard) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    const voiceChannel = await this.voice.requireVoiceChannel(
      interaction,
      member,
    );
    if (!voiceChannel) return;

    const query = interaction.options.getString("query"); // optional
    const requestedBy = member.user.username;

    await interaction.deferReply();

    const { seedTitle, queued, tracks } = await music.startRadio(
      voiceChannel,
      query,
      requestedBy,
    );

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("📻 Radio Started")
      .setDescription(`Seeded from **${seedTitle}**`)
      .addFields({ name: "🎵 Songs Queued", value: String(queued), inline: true })
      .setFooter({ text: `Started by ${requestedBy}` });

    const row = buildQueueJumpRow(tracks);
    await interaction.editReply({
      embeds: [embed],
      components: row ? [row] : [],
    });
  }
}
