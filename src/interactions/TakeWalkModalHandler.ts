import { ChannelType, MessageFlags, PermissionsBitField } from "discord.js";
import type { ModalSubmitInteraction } from "discord.js";
import type { ModalHandler } from "../core/interactions";
import type { MusicServiceRegistry } from "../services/MusicServiceRegistry";
import type { WalkService } from "../services/WalkService";

/** Handles the "how many stops?" modal submitted from `/takewalk`. */
export class TakeWalkModalHandler implements ModalHandler {
  constructor(
    private readonly registry: MusicServiceRegistry,
    private readonly walk: WalkService,
  ) {}

  matches(customId: string): boolean {
    return this.walk.parseCustomId(customId)?.targetId != null;
  }

  async handle(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = this.walk.parseCustomId(interaction.customId);
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
      const originalChannel = interaction.guild.channels.cache.get(
        parsed.channelId,
      );
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

      const steps = this.walk.clampSteps(
        interaction.fields.getTextInputValue("steps"),
      );

      await interaction.editReply(
        `🚶 Taking **${target.displayName}** for a ${steps}-stop walk...`,
      );

      this.registry.forGuild(interaction.guildId!).disconnect();

      const visited = await this.walk.takeOnWalk(
        target,
        originalChannel,
        steps,
        `Take a walk by ${interaction.user.tag}`,
      );

      await interaction.editReply({
        content: "",
        embeds: [this.walk.buildCompleteEmbed(target, originalChannel, visited)],
      });
    } catch (error) {
      console.error("Take a walk error:", error);
      await interaction.editReply(
        `❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
