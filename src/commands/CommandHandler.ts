import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { MusicService, formatDuration } from "../services/MusicService";

const EMBED_COLOR = 0xff0000;

const musicServices = new Map<string, MusicService>();

function getOrCreateService(guildId: string): MusicService {
  if (!musicServices.has(guildId)) {
    musicServices.set(guildId, new MusicService());
  }
  return musicServices.get(guildId)!;
}

async function requireVoiceChannel(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  member: GuildMember,
) {
  const ch = member.voice.channel;
  if (!ch) {
    await interaction.reply({ content: "❌ You need to be in a voice channel!", flags: MessageFlags.Ephemeral });
    return null;
  }
  return ch;
}

function isUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function parseSeekPosition(input: string): number {
  if (input.includes(":")) {
    const parts = input.split(":").map(Number);
    if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  const n = parseInt(input, 10);
  return isNaN(n) ? -1 : n;
}

export const commands = [
  new SlashCommandBuilder()
    .setName("p")
    .setDescription("Play a song from YouTube")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name or YouTube URL")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("pl")
    .setDescription("Search YouTube and pick from results")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name to search for")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("s")
    .setDescription("Skip the current song"),
  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek to a position in the current song")
    .addStringOption((option) =>
      option
        .setName("position")
        .setDescription("Position to seek to (e.g. 1:30 or 90)")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("kufur")
    .setDescription("Rastgele bir Türkçe küfür söyler"),
  new SlashCommandBuilder()
    .setName("q")
    .setDescription("Show the current music queue"),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember;
  const service = getOrCreateService(interaction.guildId!);

  try {
    switch (interaction.commandName) {
      case "pl": {
        const voiceChannel = await requireVoiceChannel(interaction, member);
        if (!voiceChannel) return;

        const query = interaction.options.getString("query", true);
        await interaction.deferReply();
        const results = await service.searchTracks(query);

        if (results.length === 0) {
          await interaction.editReply({ content: "❌ No results found!" });
          return;
        }

        const options = results.map((r) => ({
          label: r.title.slice(0, 100),
          description: `${r.duration ?? "??"} • ${r.channelName ?? ""}`.slice(0, 100),
          value: r.url,
        }));

        const select = new StringSelectMenuBuilder()
          .setCustomId("music-search")
          .setPlaceholder("Pick a song...")
          .addOptions(options);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle(`🔍 Results for: ${query}`)
          .setDescription(
            results
              .map(
                (r, i) =>
                  `**${i + 1}.** ${r.title}${r.duration ? ` \`${r.duration}\`` : ""}`,
              )
              .join("\n"),
          );

        await interaction.editReply({ embeds: [embed], components: [row] });
        break;
      }

      case "p": {
        const voiceChannel = await requireVoiceChannel(interaction, member);
        if (!voiceChannel) return;

        const query = interaction.options.getString("query", true);
        const requestedBy = member.user.username;

        await interaction.deferReply();

        const { title, duration, queued } = await service.play(
          voiceChannel,
          query,
          requestedBy,
        );

        const isPlaylist = queued > 1;
        const isNowPlaying = service.getQueueLength() === 0 && !isPlaylist;

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
        } else if (service.getQueueLength() > 0) {
          embed.addFields({
            name: "📝 Queue Position",
            value: `#${service.getQueueLength() + 1}`,
            inline: true,
          });
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case "s": {
        if (!await requireVoiceChannel(interaction, member)) return;

        const skipped = service.skip();
        await interaction.reply(skipped ? "⏭️ Skipped!" : "❌ Nothing to skip!");
        break;
      }

      case "seek": {
        if (!await requireVoiceChannel(interaction, member)) return;

        const input = interaction.options.getString("position", true);
        const seconds = parseSeekPosition(input);

        if (seconds < 0) {
          await interaction.reply({
            content: "❌ Invalid position. Use `1:30` or `90` (seconds).",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const sought = service.seek(seconds);
        if (!sought) {
          await interaction.reply({
            content: "❌ Nothing is playing right now!",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply(`⏩ Seeking to **${formatDuration(seconds)}**...`);
        break;
      }

      case "kufur": {
        const swears: string[] = JSON.parse(
          Buffer.from(
            "WyJzaWt0aXIiLCAiYW1rIiwgIsWfYWtsYWJhbi4iLCAiw6dlbnRpa+KAmWluIGhhc8SxIGtpbXlvbmxhLCBwxLF0dMSxxJ/EsW4gaGFzxLEgbWlueW9uZGUgb2x1ci4iLCAic2VuaSBtw7xqZGVsZXllbiBsZXlsZWtsZXJpbiB5b2wgaGFyaXRhc8SxbsSxIHNpa2V5aW0iLCAib2MiLCAia2FocGUiLCAiZ290dmVyZW4iLCAieWFycmFrIGthZmFsaSIsICJzZW5pIHRvcm5hIHRlemdhaGluZGEgc2lrZXJpbSIsICJpdCBvZ2x1IGl0IiwgImFsbGFoIGNhbsSxbcSxIGFsc2EgZGEgw7ZsbcO8xZ9sZXJpbmkgc2lrc2VtLiIsICJrw7xydGFqZGFuIHNhxJ8gw6fEsWttxLHFnyBvcm9zcHUgw6dvY3XEn3UiLCAiZXNlayBoZXJpZiJd",
            "base64",
          ).toString("utf-8"),
        );
        const word = swears[Math.floor(Math.random() * swears.length)] ?? "...";
        await interaction.reply(word);
        break;
      }

      case "q": {
        const currentSong = service.getCurrentSong();
        const queue = service.getQueue();

        if (!currentSong && queue.length === 0) {
          await interaction.reply({
            content: "📭 The queue is empty!",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle("🎵 Music Queue");

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
        break;
      }

    }
  } catch (error) {
    console.error("Command error:", error);
    const message = `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`;

    if (interaction.deferred) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  }
}

export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (interaction.customId !== "music-search") return;

  const member = interaction.member as GuildMember;
  const voiceChannel = await requireVoiceChannel(interaction, member);
  if (!voiceChannel) return;

  const url = interaction.values[0];
  if (!url) return;

  const requestedBy = member.user.username;
  const service = getOrCreateService(interaction.guildId!);

  await interaction.deferUpdate();

  try {
    const { title, duration } = await service.play(voiceChannel, url, requestedBy);
    const queueLength = service.getQueueLength();
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
