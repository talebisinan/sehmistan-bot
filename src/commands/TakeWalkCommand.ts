import {
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import type { VoiceGuard } from "../services/VoiceGuard";
import type { WalkService } from "../services/WalkService";
import { TAKE_A_WALK_DEFAULT_STEPS } from "../shared/constants";

/** `/takewalk <user>` — take a member in your voice channel on a 5-stop tour. */
export class TakeWalkCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("takewalk")
    .setDescription("Take someone in your voice channel on a 5-stop tour")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Who should take the walk? Must be in your voice channel")
        .setRequired(true),
    );

  constructor(
    private readonly voice: VoiceGuard,
    private readonly walk: WalkService,
  ) {}

  async execute({ interaction, member, music }: CommandContext): Promise<void> {
    const voiceChannel = await this.voice.requireVoiceModerationChannel(
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

    if (this.walk.getWalkableChannels(voiceChannel).length === 0) {
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
    music.disconnect();
    await this.walk.joinChannel(voiceChannel);
    await interaction.editReply(
      `🚶 Taking **${target.displayName}** for a ${TAKE_A_WALK_DEFAULT_STEPS}-stop walk...`,
    );

    const visited = await this.walk.takeOnWalk(
      target,
      voiceChannel,
      TAKE_A_WALK_DEFAULT_STEPS,
      `Take a walk by ${interaction.user.tag}`,
    );

    await interaction.editReply({
      content: "",
      embeds: [this.walk.buildCompleteEmbed(target, voiceChannel, visited)],
    });
  }
}
