import { MusicService } from "./MusicService";
import type { PlayableTrackResolver } from "./PlayableTrackResolver";
import type { YtdlpService } from "./YtdlpService";

/**
 * Owns one {@link MusicService} per guild, created lazily. Previously a bare
 * module-level `Map` with a free `getOrCreateService` function; now an injected
 * dependency so commands don't reach into global state.
 */
export class MusicServiceRegistry {
  private readonly services = new Map<string, MusicService>();

  constructor(
    private readonly resolver: PlayableTrackResolver,
    private readonly ytdlp: YtdlpService,
  ) {}

  forGuild(guildId: string): MusicService {
    let service = this.services.get(guildId);
    if (!service) {
      service = new MusicService(this.resolver, this.ytdlp);
      this.services.set(guildId, service);
    }
    return service;
  }
}
