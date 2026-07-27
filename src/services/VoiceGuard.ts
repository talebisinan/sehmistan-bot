import {
  GuildMember,
  MessageFlags,
  PermissionsBitField,
} from "discord.js";
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  VoiceBasedChannel,
} from "discord.js";

type RepliableInteraction =
  | ChatInputCommandInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

/**
 * Centralises the "are we allowed to touch voice?" checks that were scattered
 * as free functions in the old handler. Each guard returns the resolved subject
 * on success, or `null` after having already sent the user an ephemeral reply.
 */
export class VoiceGuard {
  /** Resolves the invoking guild member, or replies + returns null in a DM. */
  async resolveMember(
    interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  ): Promise<GuildMember | null> {
    if (!interaction.guild) {
      await this.deny(interaction, "❌ This command can only be used in a server.");
      return null;
    }
    return interaction.guild.members.fetch(interaction.user.id);
  }

  /**
   * Ensures the member is in a voice channel the bot can view, join, and speak
   * in. Used by the playback commands.
   */
  async requireVoiceChannel(
    interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
    member: GuildMember,
  ): Promise<VoiceBasedChannel | null> {
    const channel = member.voice.channel;
    if (!channel) {
      await this.deny(interaction, "❌ You need to be in a voice channel!");
      return null;
    }

    const me = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);

    if (!permissions?.has(PermissionsBitField.Flags.ViewChannel)) {
      await this.deny(
        interaction,
        `❌ I can't see the voice channel **${channel.name}**. Give me \`View Channel\` permission there.`,
      );
      return null;
    }
    if (!permissions.has(PermissionsBitField.Flags.Connect)) {
      await this.deny(
        interaction,
        `❌ I can't join **${channel.name}**. Give me \`Connect\` permission there.`,
      );
      return null;
    }
    if (!permissions.has(PermissionsBitField.Flags.Speak)) {
      await this.deny(
        interaction,
        `❌ I can join **${channel.name}**, but I can't speak. Give me \`Speak\` permission there.`,
      );
      return null;
    }

    return channel;
  }

  /**
   * Ensures both the caller and the bot hold `Move Members` (plus `View
   * Channel` for the bot) in the caller's voice channel. Used by the
   * moderation commands (`/bam`, `/bambam`, `/takewalk`).
   */
  async requireVoiceModerationChannel(
    interaction:
      | ChatInputCommandInteraction
      | UserSelectMenuInteraction
      | ModalSubmitInteraction,
    member: GuildMember,
  ): Promise<VoiceBasedChannel | null> {
    const channel = member.voice.channel;
    if (!channel) {
      await this.deny(interaction, "❌ You need to be in a voice channel!");
      return null;
    }

    const memberPermissions = channel.permissionsFor(member);
    if (!memberPermissions?.has(PermissionsBitField.Flags.MoveMembers)) {
      await this.deny(
        interaction,
        `❌ You need the \`Move Members\` permission in **${channel.name}** to use this command.`,
      );
      return null;
    }

    const me = await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);

    if (!permissions?.has(PermissionsBitField.Flags.ViewChannel)) {
      await this.deny(
        interaction,
        `❌ I can't see the voice channel **${channel.name}**. Give me \`View Channel\` permission there.`,
      );
      return null;
    }
    if (!permissions.has(PermissionsBitField.Flags.MoveMembers)) {
      await this.deny(
        interaction,
        `❌ I need the \`Move Members\` permission in **${channel.name}** to disconnect voice members.`,
      );
      return null;
    }

    return channel;
  }

  private async deny(
    interaction: RepliableInteraction,
    content: string,
  ): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
