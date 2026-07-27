import { EmbedBuilder } from "discord.js";
import type { StringSelectMenuInteraction } from "discord.js";
import type { StringSelectHandler } from "../core/interactions";
import type { MusicServiceRegistry } from "../services/MusicServiceRegistry";
import type { VoiceGuard } from "../services/VoiceGuard";
import { EMBED_COLOR } from "../shared/constants";

const CUSTOM_ID = "music-search";

/** Plays the track chosen from a `/pl` results dropdown. */
export class MusicSearchSelectHandler implements StringSelectHandler {
  constructor(
    private readonly registry: MusicServiceRegistry,
    private readonly voice: VoiceGuard,
  ) {}

  matches(customId: string): boolean {
    return customId === CUSTOM_ID;
  }

  async handle(interaction: StringSelectMenuInteraction): Promise<void> {
    const member = await this.voice.resolveMember(interaction);
    if (!member) return;

    const voiceChannel = await this.voice.requireVoiceChannel(
      interaction,
      member,
    );
    if (!voiceChannel) return;

    const url = interaction.values[0];
    if (!url) return;

    const requestedBy = member.user.username;
    const music = this.registry.forGuild(interaction.guildId!);

    await interaction.deferUpdate();

    try {
      const { title, duration } = await music.play(
        voiceChannel,
        url,
        requestedBy,
      );
      const queueLength = music.getQueueLength();
      const isNowPlaying = queueLength === 0;

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(isNowPlaying ? "▶️ Now Playing" : "➕ Added to Queue")
        .setDescription(`**${title}**`)
        .setFooter({ text: `Requested by ${requestedBy}` });

      if (duration) {
        embed.addFields({ name: "⏱️ Duration", value: duration, inline: true });
      }
      if (queueLength > 0) {
        embed.addFields({
          name: "📝 Queue Position",
          value: `#${queueLength + 1}`,
          inline: true,
        });
      }

      await interaction.editReply({ embeds: [embed], components: [] });
    } catch (error) {
      console.error("Select menu error:", error);
      await interaction.editReply({
        content: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        components: [],
      });
    }
  }
}
