import { EmbedBuilder, MessageFlags } from "discord.js";
import type { GuildMember, VoiceBasedChannel } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { DisconnectService } from "../services/DisconnectService";
import type { VoiceGuard } from "../services/VoiceGuard";
import { EMBED_COLOR } from "../shared/constants";
import { formatBulletedList } from "../shared/format";

/**
 * Shared skeleton for the voice-disconnect commands. `/bam` and `/bambam`
 * differ only in which members they target and their cosmetic copy, so the
 * flow — guard → gather targets → disconnect → report — lives here and the
 * variants fill in the hooks.
 */
export abstract class DisconnectCommand implements SlashCommand {
  abstract readonly data: SlashCommand["data"];

  protected constructor(
    protected readonly voice: VoiceGuard,
    protected readonly disconnectService: DisconnectService,
  ) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    const voiceChannel = await this.voice.requireVoiceModerationChannel(
      interaction,
      member,
    );
    if (!voiceChannel) return;

    const me = await voiceChannel.guild.members.fetchMe();
    const targets = this.selectTargets(voiceChannel, me.id);

    if (targets.length === 0) {
      await interaction.reply({
        content: this.emptyMessage(voiceChannel.name),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const { disconnected, failed } = await this.disconnectService.disconnectMembers(
      targets,
      me.id,
      music,
      this.reasonLabel(member.user.tag),
    );

    await interaction.editReply({
      embeds: [this.buildEmbed(voiceChannel.name, disconnected, failed)],
    });
  }

  private buildEmbed(
    channelName: string,
    disconnected: string[],
    failed: string[],
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(this.title)
      .setImage(this.image)
      .setDescription(
        disconnected.length > 0
          ? this.successDescription(disconnected.length, channelName)
          : this.failureDescription(channelName),
      );

    if (disconnected.length > 0) {
      embed.addFields({
        name: "Disconnected",
        value: formatBulletedList(disconnected),
      });
    }
    if (failed.length > 0) {
      embed.addFields({ name: "Failed", value: formatBulletedList(failed) });
    }

    return embed;
  }

  protected abstract readonly title: string;
  protected abstract readonly image: string;
  protected abstract selectTargets(
    channel: VoiceBasedChannel,
    ownBotId: string,
  ): GuildMember[];
  protected abstract emptyMessage(channelName: string): string;
  protected abstract reasonLabel(userTag: string): string;
  protected abstract successDescription(
    count: number,
    channelName: string,
  ): string;
  protected abstract failureDescription(channelName: string): string;
}
