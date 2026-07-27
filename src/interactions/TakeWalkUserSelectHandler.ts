import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { UserSelectMenuInteraction } from "discord.js";
import type { UserSelectHandler } from "../core/interactions";
import type { WalkService } from "../services/WalkService";
import { TAKE_A_WALK_MAX_STEPS } from "../shared/constants";

/**
 * Handles the user-select step of `/takewalk`: validates the chosen target and
 * either runs the walk immediately (when steps are baked into the customId) or
 * opens a modal to ask how many stops.
 */
export class TakeWalkUserSelectHandler implements UserSelectHandler {
  constructor(private readonly walk: WalkService) {}

  matches(customId: string): boolean {
    return this.walk.parseCustomId(customId) !== null;
  }

  async handle(interaction: UserSelectMenuInteraction): Promise<void> {
    const parsed = this.walk.parseCustomId(interaction.customId);
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

        const visited = await this.walk.takeOnWalk(
          target,
          originalChannel,
          parsed.steps,
          `Take a walk by ${interaction.user.tag}`,
        );

        await interaction.editReply({
          content: "",
          embeds: [this.walk.buildCompleteEmbed(target, originalChannel, visited)],
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
      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
        stepsInput,
      );

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
}
