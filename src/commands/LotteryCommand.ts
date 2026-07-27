import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import { EMBED_COLOR } from "../shared/constants";

/** `/lottery` — pick a random (non-bot) person from the caller's voice channel. */
export class LotteryCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("lottery")
    .setDescription("Pick a random person from your current voice channel");

  async execute({ interaction, member }: CommandContext): Promise<void> {
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: "❌ You need to be in a voice channel!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const candidates = [...voiceChannel.members.values()].filter(
      (voiceMember) => !voiceMember.user.bot,
    );

    if (candidates.length === 0) {
      await interaction.reply({
        content: `❌ No people found in **${voiceChannel.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const winner = candidates[Math.floor(Math.random() * candidates.length)]!;
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🎲 Voice Lottery")
      .setDescription(`Winner: ${winner}`)
      .addFields(
        { name: "Channel", value: voiceChannel.name, inline: true },
        { name: "Participants", value: String(candidates.length), inline: true },
      );

    await interaction.reply({ embeds: [embed] });
  }
}
