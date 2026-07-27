import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const MESSAGE_NOT_FOUND = 10008;

/** `/clean [amount]` — bulk-delete recent messages in the current channel. */
export class CleanCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Delete recent messages in this channel")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages to delete (1–100, default 10)")
        .setMinValue(1)
        .setMaxValue(100),
    );

  async execute({ interaction }: CommandContext): Promise<void> {
    const amount = interaction.options.getInteger("amount") ?? 10;
    const channel = interaction.channel;

    if (!channel || !("bulkDelete" in channel)) {
      await interaction.reply({
        content: "❌ Cannot delete messages in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const botMember = interaction.guild?.members.me;
    if (!botMember?.permissionsIn(channel).has("ManageMessages")) {
      await interaction.reply({
        content: "❌ I need the **Manage Messages** permission in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const messages = await channel.messages.fetch({ limit: amount });
      const cutoff = Date.now() - FOURTEEN_DAYS_MS;
      const recent = messages.filter((m) => m.createdTimestamp > cutoff);
      const old = messages.filter((m) => m.createdTimestamp <= cutoff);

      let deletedCount = 0;

      // bulkDelete requires ≥2 messages; fall back to individual delete for 1.
      if (recent.size >= 2) {
        const bulk = await channel.bulkDelete(recent);
        deletedCount += bulk.size;
      } else if (recent.size === 1) {
        deletedCount += await this.deleteOne(recent.first()!);
      }

      for (const msg of old.values()) {
        deletedCount += await this.deleteOne(msg);
      }

      await interaction.editReply({
        content: `🧹 Deleted ${deletedCount} message(s).`,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    } catch (error) {
      await interaction.editReply({
        content: `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  /** Deletes a single message, tolerating already-deleted ones. Returns 0/1. */
  private async deleteOne(message: {
    delete(): Promise<unknown>;
  }): Promise<number> {
    try {
      await message.delete();
      return 1;
    } catch (e: any) {
      if (e.code !== MESSAGE_NOT_FOUND) throw e;
      return 0;
    }
  }
}
