import { SlashCommandBuilder } from "discord.js";
import type { GuildMember, VoiceBasedChannel } from "discord.js";
import { DisconnectCommand } from "./DisconnectCommand";
import type { DisconnectService } from "../services/DisconnectService";
import type { VoiceGuard } from "../services/VoiceGuard";
import { BAM_GIF_URL } from "../shared/constants";

/** `/bam` — disconnect other apps (bots) from the caller's voice channel. */
export class BamCommand extends DisconnectCommand {
  readonly data = new SlashCommandBuilder()
    .setName("bam")
    .setDescription("Disconnect other apps from your current voice channel");

  protected readonly title = "💥 Bam!";
  protected readonly image = BAM_GIF_URL;

  constructor(voice: VoiceGuard, disconnectService: DisconnectService) {
    super(voice, disconnectService);
  }

  protected selectTargets(
    channel: VoiceBasedChannel,
    ownBotId: string,
  ): GuildMember[] {
    return [
      ...channel.members
        .filter((m) => m.user.bot && m.id !== ownBotId)
        .values(),
    ];
  }

  protected emptyMessage(channelName: string): string {
    return `🤷 No other apps are connected to **${channelName}**.`;
  }

  protected reasonLabel(userTag: string): string {
    return `Bam by ${userTag}`;
  }

  protected successDescription(count: number, channelName: string): string {
    return `Disconnected ${count} app(s) from **${channelName}**.`;
  }

  protected failureDescription(channelName: string): string {
    return `Couldn't disconnect any apps from **${channelName}**.`;
  }
}
