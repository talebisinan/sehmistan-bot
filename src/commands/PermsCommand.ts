import {
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { GuildMember, VoiceBasedChannel } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { WalkService } from "../services/WalkService";
import { EMBED_COLOR, TAKE_A_WALK_DEFAULT_STEPS } from "../shared/constants";
import { permissionLine } from "../shared/format";

const Flags = PermissionsBitField.Flags;

/** `/perms` — report the bot's permissions per command in the current context. */
export class PermsCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("perms")
    .setDescription("Show required bot permissions for each command");

  constructor(private readonly walk: WalkService) {}

  async execute({ interaction, member }: CommandContext): Promise<void> {
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
    const canSendHere =
      interaction.channel?.isTextBased() && "send" in interaction.channel;
    const sendChannelStatus = canSendHere
      ? "✅ Current channel supports sending messages"
      : "❌ Current channel does not support sending messages";
    const cleanChannelStatus =
      interaction.channel && "bulkDelete" in interaction.channel
        ? "✅ Current channel supports message cleanup"
        : "❌ Current channel does not support message cleanup";

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
              Flags.UseApplicationCommands,
              "Use Application Commands",
            ),
            permissionLine(textPermissions, Flags.SendMessages, "Send Messages"),
            permissionLine(textPermissions, Flags.EmbedLinks, "Embed Links"),
            permissionLine(
              textPermissions,
              Flags.ReadMessageHistory,
              "Read Message History",
            ),
            permissionLine(
              textPermissions,
              Flags.ManageMessages,
              "Manage Messages for /clean",
            ),
          ].join("\n"),
        },
        {
          name: "💬 /say",
          value: [
            sendChannelStatus,
            "Bot:",
            permissionLine(textPermissions, Flags.ViewChannel, "View Channel"),
            permissionLine(textPermissions, Flags.SendMessages, "Send Messages"),
            interaction.channel?.isThread()
              ? permissionLine(
                  textPermissions,
                  Flags.SendMessagesInThreads,
                  "Send Messages in Threads",
                )
              : "➖ Send Messages in Threads not needed here",
          ].join("\n"),
        },
        {
          name: "🧹 /clean",
          value: [
            cleanChannelStatus,
            "Caller: no Discord permission is currently enforced by the bot.",
            "Bot:",
            permissionLine(textPermissions, Flags.ViewChannel, "View Channel"),
            permissionLine(
              textPermissions,
              Flags.ReadMessageHistory,
              "Read Message History",
            ),
            permissionLine(
              textPermissions,
              Flags.ManageMessages,
              "Manage Messages",
            ),
          ].join("\n"),
        },
        {
          name: "🎶 Music commands",
          value: voiceChannel
            ? [
                "Commands: `/p`, `/pl`, `/radio`, `/s`, `/stop`, `/seek`",
                permissionLine(voicePermissions, Flags.ViewChannel, "View Channel"),
                permissionLine(voicePermissions, Flags.Connect, "Connect"),
                permissionLine(voicePermissions, Flags.Speak, "Speak"),
                permissionLine(
                  voicePermissions,
                  Flags.UseVAD,
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
                  Flags.MoveMembers,
                  "Move Members",
                ),
                "Bot:",
                permissionLine(voicePermissions, Flags.ViewChannel, "View Channel"),
                permissionLine(voicePermissions, Flags.MoveMembers, "Move Members"),
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
                  Flags.MoveMembers,
                  "Move Members",
                ),
                "Bot in original channel:",
                permissionLine(voicePermissions, Flags.ViewChannel, "View Channel"),
                permissionLine(voicePermissions, Flags.Connect, "Connect"),
                permissionLine(voicePermissions, Flags.MoveMembers, "Move Members"),
                ...this.walkDestinationLines(voiceChannel, botMember),
              ].join("\n")
            : "➖ Join a voice channel to check.",
        },
      )
      .setFooter({
        text: "✅ present • ❌ missing • ➖ not checked in this context",
      });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  private walkDestinationLines(
    voiceChannel: VoiceBasedChannel | null,
    botMember: GuildMember,
  ): string[] {
    if (!voiceChannel) {
      return ["➖ Destination channels: join voice first to check."];
    }

    const destinations = this.walk.getWalkableChannels(voiceChannel);
    if (destinations.length === 0) {
      return ["❌ No other voice channels found for `/takewalk`."];
    }

    const missing = destinations.filter((channel) => {
      const permissions = channel.permissionsFor(botMember);
      return !(
        permissions?.has(Flags.ViewChannel) &&
        permissions.has(Flags.Connect) &&
        permissions.has(Flags.MoveMembers)
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
  }
}
