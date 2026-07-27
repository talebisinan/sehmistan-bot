import {
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import type { GuildMember, VoiceBasedChannel, VoiceChannel } from "discord.js";
import {
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import {
  EMBED_COLOR,
  TAKE_A_WALK_MAX_STEPS,
  TAKE_A_WALK_STEP_DELAY_MS,
} from "../shared/constants";
import { formatBulletedList, sleep } from "../shared/format";

export interface ParsedWalkCustomId {
  invokerId: string;
  channelId: string;
  targetId?: string;
  steps?: number;
}

/**
 * Encapsulates the "take a member on a tour of voice channels" behaviour and
 * the customId contract its interactive follow-ups (`takeawalk:...`) rely on.
 * Stateless: the calling command/handler owns the interaction, this owns the
 * moving-people mechanics.
 */
export class WalkService {
  /** Clamps a raw steps input into the allowed 1..MAX range. */
  clampSteps(input: string): number {
    const parsed = parseInt(input, 10);
    if (Number.isNaN(parsed) || parsed < 1) return 1;
    return Math.min(parsed, TAKE_A_WALK_MAX_STEPS);
  }

  /** Parses a `takeawalk:invoker:channel[:target][:steps]` customId, or null. */
  parseCustomId(customId: string): ParsedWalkCustomId | null {
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
          ? this.clampSteps(stepsPart)
          : undefined,
    };
  }

  /** All other voice channels in the guild, ordered by position. */
  getWalkableChannels(originalChannel: VoiceBasedChannel): VoiceChannel[] {
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

  /** Bot joins a channel (muted) so it can move members into it. */
  async joinChannel(channel: VoiceBasedChannel): Promise<void> {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  }

  /**
   * Walks `target` through `steps` other voice channels, then always returns
   * them home (even on failure). Returns the names of channels visited.
   */
  async takeOnWalk(
    target: GuildMember,
    originalChannel: VoiceBasedChannel,
    steps: number,
    reason: string,
  ): Promise<string[]> {
    const walkChannels = this.getWalkableChannels(originalChannel);
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
      throw new Error(
        "I can't connect to any other voice channels for the walk.",
      );
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
        await this.joinChannel(nextChannel);
        await target.voice.setChannel(nextChannel, reason);
        visited.push(nextChannel.name);
        await sleep(TAKE_A_WALK_STEP_DELAY_MS);
      }
    } finally {
      await this.joinChannel(originalChannel).catch(() => {});
      if (target.voice.channelId) {
        await target.voice
          .setChannel(originalChannel, `${reason} — returning home`)
          .catch(() => {});
      }
    }

    return visited;
  }

  /** Builds the "walk complete" summary embed. */
  buildCompleteEmbed(
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
}
