import type {
  PlayableCollection,
  PlayableTrack,
} from "../PlayableTrackResolver";
import type { YtdlpService } from "../YtdlpService";
import type { MusicSourceStrategy } from "./MusicSourceStrategy";

const MAX_COLLECTION_TRACKS = 100;

/** Default playable source: YouTube URLs, YouTube playlists, and plain searches. */
export class YouTubeSourceStrategy implements MusicSourceStrategy {
  readonly name = "youtube";

  constructor(private readonly ytdlp: YtdlpService) {}

  canHandle(input: string): boolean {
    return this.isYouTubeInput(input) || !this.looksLikeUrl(input);
  }

  async resolveTrack(input: string): Promise<PlayableTrack> {
    return { ...(await this.ytdlp.resolveTrack(input)), source: "youtube" };
  }

  async resolveCollection(input: string): Promise<PlayableCollection | null> {
    if (!this.isYouTubePlaylistUrl(input)) return null;

    const tracks = await this.ytdlp.fetchPlaylist(input, MAX_COLLECTION_TRACKS);
    return {
      title: tracks[0]?.title ?? "YouTube playlist",
      tracks: tracks.map((track) => ({ ...track, source: "youtube" })),
      failed: 0,
      source: "youtube",
    };
  }

  private isYouTubeInput(input: string): boolean {
    return input.includes("youtube.com") || input.includes("youtu.be");
  }

  private isYouTubePlaylistUrl(input: string): boolean {
    try {
      const parsed = new URL(input);
      return (
        parsed.hostname.includes("youtube.com") &&
        parsed.pathname === "/playlist" &&
        !!parsed.searchParams.get("list")
      );
    } catch {
      return false;
    }
  }

  private looksLikeUrl(input: string): boolean {
    try {
      new URL(input);
      return true;
    } catch {
      return false;
    }
  }
}
