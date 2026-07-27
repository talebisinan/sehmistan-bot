import { MessageFlags, PermissionsBitField, SlashCommandBuilder } from "discord.js";
import type { PermissionResolvable } from "discord.js";
import type { CommandContext, SlashCommand } from "../core/SlashCommand";
import { sleep } from "../shared/format";

const Flags = PermissionsBitField.Flags;
const DEFAULT_TIMES = 1;
const MAX_TIMES = 30;
const SEND_DELAY_MS = 1_000;

/** `/say <text> [times]` — make the bot say text in the current channel. */
export class SayCommand implements SlashCommand {
  readonly data = new SlashCommandBuilder()
    .setName("say")
    .setDescription("Make the bot say text in this channel")
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("Text to send")
        .setMaxLength(1800)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("times")
        .setDescription(`How many times to send it (1–${MAX_TIMES}, default ${DEFAULT_TIMES})`)
        .setMinValue(1)
        .setMaxValue(MAX_TIMES),
    );

  async execute({ interaction }: CommandContext): Promise<void> {
    const channel = interaction.channel;
    if (!channel?.isTextBased() || !("send" in channel)) {
      await interaction.reply({
        content: "❌ Cannot send messages in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const botMember = await interaction.guild!.members.fetchMe();
    const permissions = botMember.permissionsIn(interaction.channelId);
    const requiredPermissions: Array<[PermissionResolvable, string]> = [
      [Flags.ViewChannel, "View Channel"],
      [Flags.SendMessages, "Send Messages"],
    ];

    if (channel.isThread()) {
      requiredPermissions.push([
        Flags.SendMessagesInThreads,
        "Send Messages in Threads",
      ]);
    }

    const missing = requiredPermissions
      .filter(([permission]) => !permissions.has(permission))
      .map(([, label]) => `\`${label}\``);

    if (missing.length > 0) {
      await interaction.reply({
        content: `❌ I need ${missing.join(", ")} permission${missing.length === 1 ? "" : "s"} in this channel.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const text = interaction.options.getString("text", true);
    const times = interaction.options.getInteger("times") ?? DEFAULT_TIMES;

    await interaction.reply({
      content: `▶️ Sending message ${times} time${times === 1 ? "" : "s"}, once per second.`,
      flags: MessageFlags.Ephemeral,
    });

    for (let i = 0; i < times; i++) {
      if (i > 0) await sleep(SEND_DELAY_MS);
      await channel.send({ content: text });
    }

    await interaction.followUp({
      content: `✅ Done sending ${times} message${times === 1 ? "" : "s"}.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
