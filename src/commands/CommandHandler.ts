import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { MusicService } from "../services/MusicService";

const musicServices = new Map<string, MusicService>();

function getOrCreateService(guildId: string): MusicService {
  if (!musicServices.has(guildId)) {
    musicServices.set(guildId, new MusicService());
  }
  return musicServices.get(guildId)!;
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
    .setName("s")
    .setDescription("Skip the current song"),
  new SlashCommandBuilder()
    .setName("hi")
    .setDescription("agzina bokumu koyucam ha"),
  new SlashCommandBuilder()
    .setName("q")
    .setDescription("Show the current music queue"),
  new SlashCommandBuilder()
    .setName("np")
    .setDescription("Show the currently playing song"),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const member = interaction.member as GuildMember;
  const service = getOrCreateService(interaction.guildId!);

  try {
    switch (interaction.commandName) {
      case "p": {
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
          await interaction.reply({
            content: "❌ You need to be in a voice channel!",
            ephemeral: true,
          });
          return;
        }

        const query = interaction.options.getString("query", true);
        const requestedBy = member.user.username;
        await interaction.deferReply();

        const { title, duration } = await service.play(
          voiceChannel,
          query,
          requestedBy,
        );
        const queueLength = service.getQueueLength();
        const isNowPlaying = queueLength === 0;

        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle(isNowPlaying ? "▶️ Now Playing" : "➕ Added to Queue")
          .setDescription(`**${title}**`)
          .setFooter({ text: `Requested by ${requestedBy}` });

        if (duration) {
          embed.addFields({
            name: "⏱️ Duration",
            value: duration,
            inline: true,
          });
        }

        if (queueLength > 0) {
          embed.addFields({
            name: "📝 Queue Position",
            value: `#${queueLength + 1}`,
            inline: true,
          });
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case "s": {
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
          await interaction.reply({
            content: "❌ You need to be in a voice channel!",
            ephemeral: true,
          });
          return;
        }

        const skipped = service.skip();
        await interaction.reply(
          skipped ? "⏭️ Skipped!" : "❌ Nothing to skip!",
        );
        break;
      }

      case "hi": {
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
          await interaction.reply({
            content: "❌ You need to be in a voice channel!",
            ephemeral: true,
          });
          return;
        }

        await interaction.reply("agzina bokumu koyucam ha 😎");
        const url = "https://youtu.be/P2vukW4dexQ?t=17";
        await service.play(voiceChannel, url, member.user.username);
        break;
      }

      case "q": {
        const currentSong = service.getCurrentSong();
        const queue = service.getQueue();

        if (!currentSong && queue.length === 0) {
          await interaction.reply({
            content: "📭 The queue is empty!",
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("🎵 Music Queue");

        if (currentSong) {
          const titlePart = currentSong.duration
            ? `**${currentSong.title}** \`${currentSong.duration}\``
            : `**${currentSong.title}**`;
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

      case "np": {
        const currentSong = service.getCurrentSong();

        if (!currentSong) {
          await interaction.reply({
            content: "❌ Nothing is playing right now!",
            ephemeral: true,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("▶️ Now Playing")
          .setDescription(`**[${currentSong.title}](${currentSong.url})**`)
          .setFooter({ text: `Requested by ${currentSong.requestedBy}` });

        if (currentSong.duration) {
          embed.addFields({
            name: "⏱️ Duration",
            value: currentSong.duration,
            inline: true,
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
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
}
