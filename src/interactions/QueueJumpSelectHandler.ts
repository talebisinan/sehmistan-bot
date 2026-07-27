import { EmbedBuilder } from "discord.js";
import type { StringSelectMenuInteraction } from "discord.js";
import type { StringSelectHandler } from "../core/interactions";
import type { MusicServiceRegistry } from "../services/MusicServiceRegistry";
import { EMBED_COLOR } from "../shared/constants";
import { buildQueueJumpRow, QUEUE_JUMP_CUSTOM_ID } from "../shared/queueJump";

/** Jumps the queue to the chosen track and rebuilds the dropdown. */
export class QueueJumpSelectHandler implements StringSelectHandler {
  constructor(private readonly registry: MusicServiceRegistry) {}

  matches(customId: string): boolean {
    return customId === QUEUE_JUMP_CUSTOM_ID;
  }

  async handle(interaction: StringSelectMenuInteraction): Promise<void> {
    const url = interaction.values[0];
    if (!url) return;

    const music = this.registry.forGuild(interaction.guildId!);

    await interaction.deferUpdate();

    const title = music.jumpTo(url);
    if (!title) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setDescription(
              "❌ That song is no longer in the queue — it may have already played.",
            ),
        ],
        components: [],
      });
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("⏭️ Jumping to…")
      .setDescription(`**${title}**`);

    // Rebuild the dropdown from the updated queue so the user can keep jumping.
    const row = buildQueueJumpRow(music.getQueue());
    await interaction.editReply({
      embeds: [successEmbed],
      components: row ? [row] : [],
    });
  }
}
