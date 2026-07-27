import { SlashCommandBuilder } from "discord.js";
import type { GuildMember, VoiceBasedChannel } from "discord.js";
import { DisconnectCommand } from "./DisconnectCommand";
import type { DisconnectService } from "../services/DisconnectService";
import type { VoiceGuard } from "../services/VoiceGuard";
import { BAMBAM_GIF_URL } from "../shared/constants";

/** `/bambam` — disconnect everyone from the caller's voice channel. */
export class BamBamCommand extends DisconnectCommand {
  readonly data = new SlashCommandBuilder()
    .setName("bambam")
    .setDescription("Disconnect everyone from your current voice channel");

  protected readonly title = "💥 Bambam!";
  protected readonly image = BAMBAM_GIF_URL;

  constructor(voice: VoiceGuard, disconnectService: DisconnectService) {
    super(voice, disconnectService);
  }

  protected selectTargets(channel: VoiceBasedChannel): GuildMember[] {
    return [...channel.members.values()];
  }

  protected emptyMessage(channelName: string): string {
    return `🤷 Nobody is connected to **${channelName}**.`;
  }

  protected reasonLabel(userTag: string): string {
    return `Bambam by ${userTag}`;
  }

  protected successDescription(count: number, channelName: string): string {
    return `Disconnected ${count} member(s) from **${channelName}**.`;
  }

  protected failureDescription(channelName: string): string {
    return `Couldn't disconnect anyone from **${channelName}**.`;
  }
}
