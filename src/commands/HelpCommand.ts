import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import { EMBED_COLOR } from "../shared/constants";

/** `/help` — list all available commands. */
export class HelpCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available bot commands");

  async execute({ interaction }: CommandContext): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🎵 Bot Commands")
      .addFields(
        {
          name: "🎶 Playback",
          value: [
            "`/p <query>` — Play a song by name or YouTube URL",
            "`/pl <query>` — Search YouTube and pick from 5 results",
            "`/radio [query]` — Start a YouTube radio mix (seeds from current song if no query given)",
            "`/s` — Skip the current song",
            "`/stop` — Stop playback and clear the entire queue",
            "`/seek <position>` — Seek within the current song (e.g. `1:30` or `90`)",
          ].join("\n"),
        },
        {
          name: "📋 Queue",
          value: [
            "`/q` — Show the current queue and now-playing song",
            "> Use the dropdown on `/radio` to jump directly to any queued song",
          ].join("\n"),
        },
        {
          name: "🧹 Utility",
          value: [
            "`/clean [amount]` — Bulk-delete recent messages (default 10, max 100)",
            "`/bam` — Disconnect other apps from your current voice channel",
            "`/bambam` — Disconnect everyone from your current voice channel",
            "`/takewalk <user>` — Take someone in your voice channel on a 5-stop tour",
            "`/lottery` — Pick a random person from your current voice channel",
            "`/perms` — Show required permissions for bot commands",
            "`/kufur` — Rastgele bir Türkçe küfür söyler",
            "`/help` — Show this message",
          ].join("\n"),
        },
      )
      .setFooter({
        text: "Tip: /radio with no argument seeds from whatever is currently playing.",
      });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
