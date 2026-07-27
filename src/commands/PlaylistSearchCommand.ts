import {
  ActionRowBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { VoiceGuard } from "../services/VoiceGuard";
import { EMBED_COLOR } from "../shared/constants";

/**
 * `/pl <query>` — search YouTube and present 5 results in a dropdown. The
 * selection is handled by {@link MusicSearchSelectHandler} via the
 * `music-search` customId.
 */
export class PlaylistSearchCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("pl")
    .setDescription("Search YouTube and pick from results")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name to search for")
        .setRequired(true),
    );

  constructor(private readonly voice: VoiceGuard) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    if (!(await this.voice.requireVoiceChannel(interaction, member))) return;

    const query = interaction.options.getString("query", true);
    await interaction.deferReply();

    const results = await music.searchTracks(query);
    if (results.length === 0) {
      await interaction.editReply({ content: "❌ No results found!" });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("music-search")
      .setPlaceholder("Pick a song...")
      .addOptions(
        results.map((result) => ({
          label: result.title.slice(0, 100),
          description: `${result.duration ?? "??"} • ${result.channelName ?? ""}`.slice(
            0,
            100,
          ),
          value: result.url,
        })),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select,
    );

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🔍 Results for: ${query}`)
      .setDescription(
        results
          .map(
            (result, i) =>
              `**${i + 1}.** ${result.title}${result.duration ? ` \`${result.duration}\`` : ""}`,
          )
          .join("\n"),
      );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }
}
