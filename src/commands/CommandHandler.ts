import {
  ActionRowBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
} from "discord.js";
import type {
  PermissionResolvable,
  VoiceBasedChannel,
  VoiceChannel,
} from "discord.js";
import {
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { MusicService, formatDuration } from "../services/MusicService";

const EMBED_COLOR = 0xff0000;
const TAKE_A_WALK_DEFAULT_STEPS = 5;
const TAKE_A_WALK_MAX_STEPS = 10;
const TAKE_A_WALK_STEP_DELAY_MS = 1_500;

const musicServices = new Map<string, MusicService>();

function getOrCreateService(guildId: string): MusicService {
  if (!musicServices.has(guildId)) {
    musicServices.set(guildId, new MusicService());
  }
  return musicServices.get(guildId)!;
}

async function resolveGuildMember(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
): Promise<GuildMember | null> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return interaction.guild.members.fetch(interaction.user.id);
}

async function requireVoiceChannel(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  member: GuildMember,
) {
  const ch = member.voice.channel;
  if (!ch) {
    await interaction.reply({
      content: "❌ You need to be in a voice channel!",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const me = await ch.guild.members.fetchMe();
  const permissions = ch.permissionsFor(me);

  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel)) {
    await interaction.reply({
      content: `❌ I can't see the voice channel **${ch.name}**. Give me \`View Channel\` permission there.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (!permissions.has(PermissionsBitField.Flags.Connect)) {
    await interaction.reply({
      content: `❌ I can't join **${ch.name}**. Give me \`Connect\` permission there.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (!permissions.has(PermissionsBitField.Flags.Speak)) {
    await interaction.reply({
      content: `❌ I can join **${ch.name}**, but I can't speak. Give me \`Speak\` permission there.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return ch;
}

async function requireVoiceModerationChannel(
  interaction:
    | ChatInputCommandInteraction
    | UserSelectMenuInteraction
    | ModalSubmitInteraction,
  member: GuildMember,
) {
  const ch = member.voice.channel;
  if (!ch) {
    await interaction.reply({
      content: "❌ You need to be in a voice channel!",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const memberPermissions = ch.permissionsFor(member);
  if (!memberPermissions?.has(PermissionsBitField.Flags.MoveMembers)) {
    await interaction.reply({
      content: `❌ You need the \`Move Members\` permission in **${ch.name}** to use this command.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const me = await ch.guild.members.fetchMe();
  const permissions = ch.permissionsFor(me);

  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel)) {
    await interaction.reply({
      content: `❌ I can't see the voice channel **${ch.name}**. Give me \`View Channel\` permission there.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (!permissions.has(PermissionsBitField.Flags.MoveMembers)) {
    await interaction.reply({
      content: `❌ I need the \`Move Members\` permission in **${ch.name}** to disconnect voice members.`,
      flags: MessageFlags.Ephemeral,
    });
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
    if (parts.length === 3)
      return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
    if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  const n = parseInt(input, 10);
  return isNaN(n) ? -1 : n;
}

function formatBulletedList(items: string[], maxItems = 20): string {
  const shown = items.slice(0, maxItems).map((name) => `• ${name}`);
  if (items.length > maxItems) {
    shown.push(`• ...and ${items.length - maxItems} more`);
  }
  return shown.join("\n").slice(0, 1024);
}

function permissionLine(
  permissions: Readonly<PermissionsBitField> | null | undefined,
  permission: PermissionResolvable,
  label: string,
): string {
  return `${permissions?.has(permission) ? "✅" : "❌"} \`${label}\``;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTakeAWalkCustomId(customId: string): {
  invokerId: string;
  channelId: string;
  targetId?: string;
  steps?: number;
} | null {
  const [prefix, invokerId, channelId, targetPart, stepsPart] =
    customId.split(":");
  if (prefix !== "takeawalk" || !invokerId || !channelId) return null;

  return {
    invokerId,
    channelId,
    targetId:
      targetPart && targetPart !== "select" ? targetPart : undefined,
    steps:
      stepsPart && stepsPart !== "ask"
        ? clampTakeAWalkSteps(stepsPart)
        : undefined,
  };
}

function clampTakeAWalkSteps(input: string): number {
  const parsed = parseInt(input, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  return Math.min(parsed, TAKE_A_WALK_MAX_STEPS);
}

function getWalkableVoiceChannels(
  originalChannel: VoiceBasedChannel,
): VoiceChannel[] {
  const channels: VoiceChannel[] = [];

  for (const channel of originalChannel.guild.channels.cache.values()) {
    if (
      channel.type === ChannelType.GuildVoice &&
      channel.id !== originalChannel.id
    ) {
      channels.push(channel);
    }
  }

  return channels.sort((a, b) => a.rawPosition - b.rawPosition);
}

async function joinTakeAWalkChannel(channel: VoiceBasedChannel): Promise<void> {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
}

function buildWalkCompleteEmbed(
  target: GuildMember,
  originalChannel: VoiceBasedChannel,
  visited: string[],
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("🚶 Walk complete")
    .setDescription(
      `Returned **${target.displayName}** to **${originalChannel.name}**.`,
    )
    .addFields({
      name: `Visited ${visited.length} stop(s)`,
      value: formatBulletedList(visited),
    });
}

async function takeMemberOnWalk(
  target: GuildMember,
  originalChannel: VoiceBasedChannel,
  steps: number,
  reason: string,
): Promise<string[]> {
  const walkChannels = getWalkableVoiceChannels(originalChannel);
  if (walkChannels.length === 0) {
    throw new Error("There are no other voice channels to walk through.");
  }

  const me = await originalChannel.guild.members.fetchMe();
  const availableChannels = walkChannels.filter((channel) => {
    const permissions = channel.permissionsFor(me);
    return (
      permissions?.has(PermissionsBitField.Flags.ViewChannel) &&
      permissions.has(PermissionsBitField.Flags.Connect) &&
      permissions.has(PermissionsBitField.Flags.MoveMembers)
    );
  });

  if (availableChannels.length === 0) {
    throw new Error("I can't connect to any other voice channels for the walk.");
  }

  const visited: string[] = [];

  try {
    for (let i = 0; i < steps; i++) {
      if (!target.voice.channelId) {
        throw new Error(
          `${target.displayName} left voice before the walk finished.`,
        );
      }

      const nextChannel = availableChannels[i % availableChannels.length]!;
      await joinTakeAWalkChannel(nextChannel);
      await target.voice.setChannel(nextChannel, reason);
      visited.push(nextChannel.name);
      await sleep(TAKE_A_WALK_STEP_DELAY_MS);
    }
  } finally {
    await joinTakeAWalkChannel(originalChannel).catch(() => {});
    if (target.voice.channelId) {
      await target.voice
        .setChannel(originalChannel, `${reason} — returning home`)
        .catch(() => {});
    }
  }

  return visited;
}

async function disconnectVoiceMembers(
  targets: GuildMember[],
  ownBotId: string,
  service: MusicService,
  reason: string,
): Promise<{ disconnected: string[]; failed: string[] }> {
  const results = await Promise.allSettled(
    targets.map(async (target) => {
      if (target.id === ownBotId) {
        service.disconnect();
      } else {
        await target.voice.disconnect(reason);
      }
      return target.displayName;
    }),
  );

  const disconnected: string[] = [];
  const failed: string[] = [];

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      disconnected.push(result.value);
    } else {
      failed.push(targets[i]?.displayName ?? "unknown member");
    }
  });

  return { disconnected, failed };
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
    .setName("stop")
    .setDescription("Stop playback and clear the entire queue"),
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
  new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Delete recent messages in this channel")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages to delete (1–100, default 10)")
        .setMinValue(1)
        .setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName("bam")
    .setDescription("Disconnect other apps from your current voice channel"),
  new SlashCommandBuilder()
    .setName("bambam")
    .setDescription("Disconnect everyone from your current voice channel"),
  new SlashCommandBuilder()
    .setName("takewalk")
    .setDescription("Take someone in your voice channel on a 5-stop tour")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Who should take the walk? Must be in your voice channel")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("perms")
    .setDescription("Show required bot permissions for each command"),
  new SlashCommandBuilder()
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
    ),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available bot commands"),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const member = await resolveGuildMember(interaction);
  if (!member) return;

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
          description: `${r.duration ?? "??"} • ${r.channelName ?? ""}`.slice(
            0,
            100,
          ),
          value: r.url,
        }));

        const select = new StringSelectMenuBuilder()
          .setCustomId("music-search")
          .setPlaceholder("Pick a song...")
          .addOptions(options);

        const row =
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

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
          .setDescription(
            `**${title}**${isPlaylist ? ` and ${queued - 1} more` : ""}`,
          )
          .setFooter({ text: `Requested by ${requestedBy}` });

        if (duration && !isPlaylist) {
          embed.addFields({
            name: "⏱️ Duration",
            value: duration,
            inline: true,
          });
        }

        if (isPlaylist) {
          embed.addFields({
            name: "🎵 Songs",
            value: String(queued),
            inline: true,
          });
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
        if (!(await requireVoiceChannel(interaction, member))) return;

        const skipped = service.skip();
        await interaction.reply(
          skipped ? "⏭️ Skipped!" : "❌ Nothing to skip!",
        );
        break;
      }

      case "stop": {
        if (!(await requireVoiceChannel(interaction, member))) return;
        const stopped = service.stop();
        await interaction.reply(
          stopped ? "⏹️ Stopped and queue cleared!" : "❌ Nothing is playing!",
        );
        break;
      }

      case "seek": {
        if (!(await requireVoiceChannel(interaction, member))) return;

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

        await interaction.reply(
          `⏩ Seeking to **${formatDuration(seconds)}**...`,
        );
        break;
      }

      case "kufur": {
        const swears: string[] = JSON.parse(
          Buffer.from(
            "WyJzaWt0aXIiLCJhbWsiLCLFn2FrbGFiYW4uIiwiw6dlbnRpaydpbiBoYXPEsSBraW15b25sYSwgcMSxdHTEscSfxLFuIGhhc8SxIG1pbnlvbmRlIG9sdXIuIiwic2VuaSBtw7xqZGVsZXllbiBsZXlsZWtsZXJpbiB5b2wgaGFyaXRhc8SxbsSxIHNpa2V5aW0iLCJvw6ciLCJrYWhwZSIsImfDtnR2ZXJlbiIsInlhcnJhayBrYWZhbMSxIiwic2VuaSB0b3JuYSB0ZXpnYWhpbmRhIHNpa2VyaW0iLCJpdCBvxJ9sdSBpdCIsImFsbGFoIGNhbsSxbcSxIGFsc2EgZGEgw7ZsbcO8xZ9sZXJpbmkgc2lrc2VtLiIsImvDvHJ0YWpkYW4gc2HEnyDDp8Sxa23EscWfIG9yb3NwdSDDp29jdcSfdSIsImXFn2VrIGhlcmlmIiwib2UiLCJvw6ciLCJhbmFuxLEga8SxeW1hIG1ha2luZXNpbmUgYXRhciwgeWFyxLFzxLFuxLEga8SxeWFyLCB5YXLEsXPEsW7EsSBzaWtpcCBhdGFyxLFtLiIsIkFsaWsgT8OHIiwiQmlyIGRhaGEgeWF6ZMSxxJ/EsW7EsSBnw7ZyZW0sIGJhY8SxbsSxIHNpa2VtIiwiZGFsbGFtYSIsImXFn8Wfb8SfdWx1ZcWfxZ9layIsIllhcnJhayIsIlRhxZ/Fn2FrIiwiT3Jvc3B1bnVuIGbEsXJsYXR0xLHEn8SxIiwiWcSxcnTEsWsgYW3EsW4gZmVyeWFkxLEiXQ==",
            "base64",
          ).toString("utf-8"),
        );
        const word = swears[Math.floor(Math.random() * swears.length)] ?? "...";
        await interaction.reply({
          content: word,
          flags: MessageFlags.Ephemeral,
        });
        if (
          interaction.channel?.isTextBased() &&
          !interaction.channel.isThread() &&
          "send" in interaction.channel
        ) {
          await interaction.channel.send({ content: word, tts: true });
        }
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
        break;
      }

      case "bam": {
        const voiceChannel = await requireVoiceModerationChannel(
          interaction,
          member,
        );
        if (!voiceChannel) return;

        const me = await voiceChannel.guild.members.fetchMe();
        const targets = voiceChannel.members.filter(
          (voiceMember) => voiceMember.user.bot && voiceMember.id !== me.id,
        );

        if (targets.size === 0) {
          await interaction.reply({
            content: `🤷 No other apps are connected to **${voiceChannel.name}**.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply();

        const { disconnected, failed } = await disconnectVoiceMembers(
          [...targets.values()],
          me.id,
          service,
          `Bam by ${member.user.tag}`,
        );

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle("💥 Bam!")
          .setDescription(
            disconnected.length > 0
              ? `Disconnected ${disconnected.length} app(s) from **${voiceChannel.name}**.`
              : `Couldn't disconnect any apps from **${voiceChannel.name}**.`,
          );

        if (disconnected.length > 0) {
          embed.addFields({
            name: "Disconnected",
            value: formatBulletedList(disconnected),
          });
        }

        if (failed.length > 0) {
          embed.addFields({
            name: "Failed",
            value: formatBulletedList(failed),
          });
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case "bambam": {
        const voiceChannel = await requireVoiceModerationChannel(
          interaction,
          member,
        );
        if (!voiceChannel) return;

        const me = await voiceChannel.guild.members.fetchMe();
        const targetList = [...voiceChannel.members.values()];

        if (targetList.length === 0) {
          await interaction.reply({
            content: `🤷 Nobody is connected to **${voiceChannel.name}**.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply();

        const { disconnected, failed } = await disconnectVoiceMembers(
          targetList,
          me.id,
          service,
          `Bambam by ${member.user.tag}`,
        );

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle("💥 Bambam!")
          .setDescription(
            disconnected.length > 0
              ? `Disconnected ${disconnected.length} member(s) from **${voiceChannel.name}**.`
              : `Couldn't disconnect anyone from **${voiceChannel.name}**.`,
          );

        if (disconnected.length > 0) {
          embed.addFields({
            name: "Disconnected",
            value: formatBulletedList(disconnected),
          });
        }

        if (failed.length > 0) {
          embed.addFields({
            name: "Failed",
            value: formatBulletedList(failed),
          });
        }

        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case "takewalk": {
        const voiceChannel = await requireVoiceModerationChannel(
          interaction,
          member,
        );
        if (!voiceChannel) return;

        const me = await voiceChannel.guild.members.fetchMe();
        const permissions = voiceChannel.permissionsFor(me);
        if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
          await interaction.reply({
            content: `❌ I need the \`Connect\` permission in **${voiceChannel.name}** to start the walk.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const walkChannels = getWalkableVoiceChannels(voiceChannel);
        if (walkChannels.length === 0) {
          await interaction.reply({
            content: "❌ There are no other voice channels to walk through.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const selectedUser = interaction.options.getUser("user", true);
        const target = await interaction.guild!.members.fetch(selectedUser.id);
        if (target.id === interaction.client.user?.id) {
          await interaction.reply({
            content: "❌ I can't take myself on a walk. Pick someone else.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (target.voice.channelId !== voiceChannel.id) {
          await interaction.reply({
            content: `❌ **${target.displayName}** needs to be in **${voiceChannel.name}**.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        service.disconnect();
        await joinTakeAWalkChannel(voiceChannel);
        await interaction.editReply(
          `🚶 Taking **${target.displayName}** for a ${TAKE_A_WALK_DEFAULT_STEPS}-stop walk...`,
        );

        const visited = await takeMemberOnWalk(
          target,
          voiceChannel,
          TAKE_A_WALK_DEFAULT_STEPS,
          `Take a walk by ${interaction.user.tag}`,
        );

        await interaction.editReply({
          content: "",
          embeds: [buildWalkCompleteEmbed(target, voiceChannel, visited)],
        });
        break;
      }

      case "perms": {
        const botMember = await interaction.guild!.members.fetchMe();
        const voiceChannel = member.voice.channel;
        const currentChannel = interaction.guild!.channels.cache.get(
          interaction.channelId,
        );
        const textPermissions = currentChannel
          ? currentChannel.permissionsFor(botMember)
          : null;
        const voicePermissions = voiceChannel
          ? voiceChannel.permissionsFor(botMember)
          : null;
        const callerVoicePermissions = voiceChannel
          ? voiceChannel.permissionsFor(member)
          : null;

        const voiceContext = voiceChannel
          ? `Checking voice channel: **${voiceChannel.name}**`
          : "Join a voice channel to check voice-command permissions here.";

        const walkDestinationLines = voiceChannel
          ? (() => {
              const destinations = getWalkableVoiceChannels(voiceChannel);
              if (destinations.length === 0) {
                return ["❌ No other voice channels found for `/takewalk`."];
              }

              const missing = destinations.filter((channel) => {
                const permissions = channel.permissionsFor(botMember);
                return !(
                  permissions?.has(PermissionsBitField.Flags.ViewChannel) &&
                  permissions.has(PermissionsBitField.Flags.Connect) &&
                  permissions.has(PermissionsBitField.Flags.MoveMembers)
                );
              });

              const usableCount = destinations.length - missing.length;
              const loopNote = `/takewalk uses ${TAKE_A_WALK_DEFAULT_STEPS} stops and loops those ${usableCount} usable channel(s) if needed.`;

              if (missing.length === 0) {
                return [
                  `✅ Destination channels: ${usableCount}/${destinations.length} usable`,
                  loopNote,
                ];
              }

              return [
                `❌ Destination channels: ${usableCount}/${destinations.length} usable`,
                loopNote,
                `Missing in: ${missing
                  .slice(0, 5)
                  .map((channel) => `**${channel.name}**`)
                  .join(", ")}${missing.length > 5 ? `, and ${missing.length - 5} more` : ""}`,
              ];
            })()
          : ["➖ Destination channels: join voice first to check."];

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle("🔐 Permission Check")
          .setDescription(voiceContext)
          .addFields(
            {
              name: "💬 General / text channel",
              value: [
                permissionLine(
                  textPermissions,
                  PermissionsBitField.Flags.UseApplicationCommands,
                  "Use Application Commands",
                ),
                permissionLine(
                  textPermissions,
                  PermissionsBitField.Flags.SendMessages,
                  "Send Messages",
                ),
                permissionLine(
                  textPermissions,
                  PermissionsBitField.Flags.EmbedLinks,
                  "Embed Links",
                ),
                permissionLine(
                  textPermissions,
                  PermissionsBitField.Flags.ReadMessageHistory,
                  "Read Message History",
                ),
                permissionLine(
                  textPermissions,
                  PermissionsBitField.Flags.ManageMessages,
                  "Manage Messages for /clean",
                ),
              ].join("\n"),
            },
            {
              name: "🎶 Music commands",
              value: voiceChannel
                ? [
                    "Commands: `/p`, `/pl`, `/radio`, `/s`, `/stop`, `/seek`",
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.ViewChannel,
                      "View Channel",
                    ),
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.Connect,
                      "Connect",
                    ),
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.Speak,
                      "Speak",
                    ),
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.UseVAD,
                      "Use Voice Activity recommended",
                    ),
                  ].join("\n")
                : "➖ Join a voice channel to check.",
            },
            {
              name: "💥 /bam and /bambam",
              value: voiceChannel
                ? [
                    "Caller:",
                    permissionLine(
                      callerVoicePermissions,
                      PermissionsBitField.Flags.MoveMembers,
                      "Move Members",
                    ),
                    "Bot:",
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.ViewChannel,
                      "View Channel",
                    ),
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.MoveMembers,
                      "Move Members",
                    ),
                    "Role hierarchy still matters for moving/disconnecting targets.",
                  ].join("\n")
                : "➖ Join a voice channel to check.",
            },
            {
              name: "🚶 /takewalk",
              value: voiceChannel
                ? [
                    "Caller:",
                    permissionLine(
                      callerVoicePermissions,
                      PermissionsBitField.Flags.MoveMembers,
                      "Move Members",
                    ),
                    "Bot in original channel:",
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.ViewChannel,
                      "View Channel",
                    ),
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.Connect,
                      "Connect",
                    ),
                    permissionLine(
                      voicePermissions,
                      PermissionsBitField.Flags.MoveMembers,
                      "Move Members",
                    ),
                    ...walkDestinationLines,
                  ].join("\n")
                : "➖ Join a voice channel to check.",
            },
          )
          .setFooter({
            text: "✅ present • ❌ missing • ➖ not checked in this context",
          });

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        break;
      }

      case "clean": {
        const amount = interaction.options.getInteger("amount") ?? 10;

        if (!interaction.channel || !("bulkDelete" in interaction.channel)) {
          await interaction.reply({
            content: "❌ Cannot delete messages in this channel.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const botMember = interaction.guild?.members.me;
        if (
          !botMember?.permissionsIn(interaction.channel).has("ManageMessages")
        ) {
          await interaction.reply({
            content:
              "❌ I need the **Manage Messages** permission in this channel.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const channel = interaction.channel;
          const messages = await channel.messages.fetch({ limit: amount });
          const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
          const recent = messages.filter((m) => m.createdTimestamp > cutoff);
          const old = messages.filter((m) => m.createdTimestamp <= cutoff);

          let deletedCount = 0;

          // bulkDelete requires ≥2 messages; fall back to individual delete for 1
          if (recent.size >= 2) {
            const bulk = await channel.bulkDelete(recent);
            deletedCount += bulk.size;
          } else if (recent.size === 1) {
            try {
              await recent.first()!.delete();
              deletedCount++;
            } catch (e: any) {
              if (e.code !== 10008) throw e;
            }
          }

          for (const msg of old.values()) {
            try {
              await msg.delete();
              deletedCount++;
            } catch (e: any) {
              if (e.code !== 10008) throw e;
            }
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
        break;
      }

      case "help": {
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
                "`/perms` — Show required permissions for bot commands",
                "`/kufur` — Rastgele bir Türkçe küfür söyler",
                "`/help` — Show this message",
              ].join("\n"),
            },
          )
          .setFooter({
            text: "Tip: /radio with no argument seeds from whatever is currently playing.",
          });

        await interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
        break;
      }

      case "radio": {
        const voiceChannel = await requireVoiceChannel(interaction, member);
        if (!voiceChannel) return;

        const query = interaction.options.getString("query"); // optional
        const requestedBy = member.user.username;

        await interaction.deferReply();

        const { seedTitle, queued, tracks } = await service.startRadio(
          voiceChannel,
          query,
          requestedBy,
        );

        const embed = new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setTitle("📻 Radio Started")
          .setDescription(`Seeded from **${seedTitle}**`)
          .addFields({
            name: "🎵 Songs Queued",
            value: String(queued),
            inline: true,
          })
          .setFooter({ text: `Started by ${requestedBy}` });

        const snapshot = tracks.slice(0, 25);

        if (snapshot.length === 0) {
          await interaction.editReply({ embeds: [embed] });
          break;
        }

        const options = snapshot.map((item, i) => {
          const label = `${i + 1}. ${item.title}`.slice(0, 100);
          const opt: { label: string; value: string; description?: string } = {
            label,
            value: item.url,
          };
          if (item.duration) opt.description = `⏱️ ${item.duration}`;
          return opt;
        });

        const select = new StringSelectMenuBuilder()
          .setCustomId("queue-jump")
          .setPlaceholder("⏭️ Jump to a song…")
          .addOptions(options);

        const row =
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        await interaction.editReply({ embeds: [embed], components: [row] });
        break;
      }
    }
  } catch (error) {
    console.error("Command error:", error);
    const message = `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`;

    if (interaction.deferred) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (interaction.customId === "music-search") {
    const member = await resolveGuildMember(interaction);
    if (!member) return;

    const voiceChannel = await requireVoiceChannel(interaction, member);
    if (!voiceChannel) return;

    const url = interaction.values[0];
    if (!url) return;

    const requestedBy = member.user.username;
    const service = getOrCreateService(interaction.guildId!);

    await interaction.deferUpdate();

    try {
      const { title, duration } = await service.play(
        voiceChannel,
        url,
        requestedBy,
      );
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
    return;
  }

  if (interaction.customId === "queue-jump") {
    const url = interaction.values[0];
    if (!url) return;

    const service = getOrCreateService(interaction.guildId!);

    await interaction.deferUpdate();

    const title = service.jumpTo(url);

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

    // Rebuild the dropdown from the updated queue so the user can keep jumping.
    const remaining = service.getQueue().slice(0, 25);

    const successEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("⏭️ Jumping to…")
      .setDescription(`**${title}**`);

    if (remaining.length === 0) {
      await interaction.editReply({ embeds: [successEmbed], components: [] });
      return;
    }

    const jumpOptions = remaining.map((item, i) => {
      const label = `${i + 1}. ${item.title}`.slice(0, 100);
      const opt: { label: string; value: string; description?: string } = {
        label,
        value: item.url,
      };
      if (item.duration) opt.description = `⏱️ ${item.duration}`;
      return opt;
    });

    const jumpSelect = new StringSelectMenuBuilder()
      .setCustomId("queue-jump")
      .setPlaceholder("⏭️ Jump to a song…")
      .addOptions(jumpOptions);

    const jumpRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(jumpSelect);

    await interaction.editReply({
      embeds: [successEmbed],
      components: [jumpRow],
    });
    return;
  }
}

export async function handleUserSelectMenu(
  interaction: UserSelectMenuInteraction,
): Promise<void> {
  const parsed = parseTakeAWalkCustomId(interaction.customId);
  if (!parsed) return;

  try {
    if (interaction.user.id !== parsed.invokerId) {
      await interaction.reply({
        content: "❌ This walk is not yours to start.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetId = interaction.values[0];
    if (!targetId) return;

    const originalChannel = interaction.guild.channels.cache.get(
      parsed.channelId,
    );
    if (originalChannel?.type !== ChannelType.GuildVoice) {
      await interaction.reply({
        content: "❌ The original voice channel is gone.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = await interaction.guild.members.fetch(targetId);
    if (target.id === interaction.client.user?.id) {
      await interaction.reply({
        content: "❌ I can't take myself on a walk. Pick someone else.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (target.voice.channelId !== originalChannel.id) {
      await interaction.reply({
        content: `❌ **${target.displayName}** needs to be in **${originalChannel.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.steps) {
      await interaction.deferUpdate();
      await interaction.editReply({
        content: `🚶 Taking **${target.displayName}** for a ${parsed.steps}-stop walk...`,
        components: [],
      });

      const visited = await takeMemberOnWalk(
        target,
        originalChannel,
        parsed.steps,
        `Take a walk by ${interaction.user.tag}`,
      );

      await interaction.editReply({
        content: "",
        embeds: [buildWalkCompleteEmbed(target, originalChannel, visited)],
        components: [],
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        `takeawalk:${parsed.invokerId}:${originalChannel.id}:${target.id}`,
      )
      .setTitle("Take a walk");
    const stepsInput = new TextInputBuilder()
      .setCustomId("steps")
      .setLabel(`How many stops? Max ${TAKE_A_WALK_MAX_STEPS}`)
      .setPlaceholder("Example: 5")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);
    const row =
      new ActionRowBuilder<TextInputBuilder>().addComponents(stepsInput);

    await interaction.showModal(modal.addComponents(row));
  } catch (error) {
    console.error("Take a walk user select error:", error);
    const message = `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, components: [] });
    } else {
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const parsed = parseTakeAWalkCustomId(interaction.customId);
  if (!parsed?.targetId) return;

  if (interaction.user.id !== parsed.invokerId) {
    await interaction.reply({
      content: "❌ This walk is not yours to start.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({
      content: "❌ This can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const originalChannel = interaction.guild.channels.cache.get(parsed.channelId);
    if (originalChannel?.type !== ChannelType.GuildVoice) {
      await interaction.editReply("❌ The original voice channel is gone.");
      return;
    }

    const invoker = await interaction.guild.members.fetch(parsed.invokerId);
    if (invoker.voice.channelId !== originalChannel.id) {
      await interaction.editReply(
        `❌ You need to stay in **${originalChannel.name}** to start the walk.`,
      );
      return;
    }

    const invokerPermissions = originalChannel.permissionsFor(invoker);
    if (!invokerPermissions?.has(PermissionsBitField.Flags.MoveMembers)) {
      await interaction.editReply(
        `❌ You need the \`Move Members\` permission in **${originalChannel.name}** to start the walk.`,
      );
      return;
    }

    const me = await interaction.guild.members.fetchMe();
    const botPermissions = originalChannel.permissionsFor(me);
    if (!botPermissions?.has(PermissionsBitField.Flags.ViewChannel)) {
      await interaction.editReply(
        `❌ I can't see **${originalChannel.name}**. Give me \`View Channel\` permission there.`,
      );
      return;
    }
    if (!botPermissions.has(PermissionsBitField.Flags.Connect)) {
      await interaction.editReply(
        `❌ I need the \`Connect\` permission in **${originalChannel.name}** to start the walk.`,
      );
      return;
    }
    if (!botPermissions.has(PermissionsBitField.Flags.MoveMembers)) {
      await interaction.editReply(
        `❌ I need the \`Move Members\` permission in **${originalChannel.name}** to start the walk.`,
      );
      return;
    }

    const target = await interaction.guild.members.fetch(parsed.targetId);
    if (target.voice.channelId !== originalChannel.id) {
      await interaction.editReply(
        `❌ **${target.displayName}** needs to still be in **${originalChannel.name}**.`,
      );
      return;
    }

    const steps = clampTakeAWalkSteps(
      interaction.fields.getTextInputValue("steps"),
    );

    await interaction.editReply(
      `🚶 Taking **${target.displayName}** for a ${steps}-stop walk...`,
    );

    const service = getOrCreateService(interaction.guildId!);
    service.disconnect();

    const visited = await takeMemberOnWalk(
      target,
      originalChannel,
      steps,
      `Take a walk by ${interaction.user.tag}`,
    );

    await interaction.editReply({
      content: "",
      embeds: [buildWalkCompleteEmbed(target, originalChannel, visited)],
    });
  } catch (error) {
    console.error("Take a walk error:", error);
    await interaction.editReply(
      `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
