import type { GuildMember } from "discord.js";
import type { MusicService } from "./MusicService";

export interface DisconnectResult {
  disconnected: string[];
  failed: string[];
}

/**
 * Disconnects a set of members from voice. The bot itself is a special case:
 * it tears down its own {@link MusicService} connection rather than issuing a
 * self-disconnect. Shared by `/bam` and `/bambam`.
 */
export class DisconnectService {
  async disconnectMembers(
    targets: GuildMember[],
    ownBotId: string,
    service: MusicService,
    reason: string,
  ): Promise<DisconnectResult> {
    const results = await Promise.allSettled(
      targets.map(async (target) => {
        if (target.id === ownBotId) {
          service.disconnect();
        } else {
          await target.voice.disconnect(reason);
        }
        return target.displayName;
      }),
    );

    const disconnected: string[] = [];
    const failed: string[] = [];

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        disconnected.push(result.value);
      } else {
        failed.push(targets[i]?.displayName ?? "unknown member");
      }
    });

    return { disconnected, failed };
  }
}
