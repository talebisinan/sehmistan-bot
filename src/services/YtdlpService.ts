import { spawn, type ChildProcess } from "child_process";

export interface YtdlpTrack {
  url: string;
  title: string;
  durationSec: number;
  channelName?: string;
}

type YtdlpEntry = {
  id?: unknown;
  url?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  title?: unknown;
  duration?: unknown;
  channel?: unknown;
  uploader?: unknown;
};

type YtdlpResponse = YtdlpEntry & {
  entries?: unknown;
};

const YTDLP_METADATA_TIMEOUT_MS = 45_000;

/**
 * Single integration point for YouTube metadata/search/playlist/radio and stream
 * arguments. Audio is still piped by MusicService; this service owns yt-dlp's
 * argument contracts and JSON parsing.
 */
export class YtdlpService {
  private hasLoggedAuthConfig = false;

  async resolveTrack(searchOrUrl: string): Promise<YtdlpTrack> {
    if (this.isYouTubeUrl(searchOrUrl)) {
      try {
        return await this.fetchVideoInfo(searchOrUrl);
      } catch (error) {
        console.error("⚠️ yt-dlp video info failed:", error);
        return { url: searchOrUrl, title: "YouTube Video", durationSec: 0 };
      }
    }

    const [track] = await this.searchTracks(searchOrUrl, 1);
    if (!track) throw new Error("yt-dlp search returned no usable results");
    return track;
  }

  async searchTracks(query: string, limit: number): Promise<YtdlpTrack[]> {
    const response = await this.runYtdlpJson(
      this.buildSearchArgs(query, limit),
      "search",
    );
    return this.tracksFromResponse(response).slice(0, limit);
  }

  async fetchPlaylist(url: string, limit: number): Promise<YtdlpTrack[]> {
    const entries = await this.runYtdlpJsonLines(
      this.buildPlaylistArgs(url, limit),
      "playlist",
    );
    return entries
      .map((entry) => this.trackFromEntry(entry))
      .filter((track): track is YtdlpTrack => track !== null)
      .slice(0, limit);
  }

  async fetchRadioTracks(videoId: string, limit: number): Promise<YtdlpTrack[]> {
    const radioUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
    const entries = await this.runYtdlpJsonLines(
      this.buildPlaylistArgs(radioUrl, limit),
      "radio",
    );
    return entries
      .map((entry) => this.trackFromEntry(entry))
      .filter((track): track is YtdlpTrack => track !== null)
      .slice(0, limit);
  }

  buildStreamArgs(url: string): string[] {
    const args = ["-f", "bestaudio/best", "-o", "-", "--no-playlist"];
    this.addSharedArgs(args);
    args.push(url);
    return args;
  }

  private async fetchVideoInfo(url: string): Promise<YtdlpTrack> {
    const response = await this.runYtdlpJson(
      this.buildVideoInfoArgs(url),
      "video info",
    );
    const track = this.trackFromEntry(response);
    if (!track) throw new Error("yt-dlp returned no usable video info");
    return track;
  }

  private buildVideoInfoArgs(url: string): string[] {
    const args = [
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
    ];
    this.addSharedArgs(args);
    args.push(url);
    return args;
  }

  private buildSearchArgs(query: string, limit: number): string[] {
    const safeLimit = Math.max(1, Math.min(limit, 25));
    const args = [
      "--dump-single-json",
      "--flat-playlist",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--default-search",
      `ytsearch${safeLimit}`,
    ];
    this.addSharedArgs(args);
    args.push(query);
    return args;
  }

  private buildPlaylistArgs(url: string, limit: number): string[] {
    const args = [
      "--flat-playlist",
      "--dump-json",
      "--skip-download",
      "--no-warnings",
      "--playlist-end",
      String(Math.max(1, limit)),
    ];
    this.addSharedArgs(args);
    args.push(url);
    return args;
  }

  private addSharedArgs(args: string[]): void {
    const youtubePlayerClient =
      process.env.YTDLP_YOUTUBE_PLAYER_CLIENT?.trim() || "android,tv_embedded";
    args.push(
      "--extractor-args",
      `youtube:player_client=${youtubePlayerClient}`,
    );

    const jsRuntimes = process.env.YTDLP_JS_RUNTIMES?.trim();
    if (jsRuntimes) args.push("--js-runtimes", jsRuntimes);

    const cookiesFile = process.env.YTDLP_COOKIES_FILE?.trim();
    const cookiesBrowser = process.env.YTDLP_COOKIES_BROWSER?.trim();
    if (cookiesFile) {
      args.push("--cookies", cookiesFile);
      this.logAuthConfigOnce(`🍪 yt-dlp cookies file: ${cookiesFile}`);
    } else if (cookiesBrowser) {
      args.push("--cookies-from-browser", cookiesBrowser);
      this.logAuthConfigOnce(`🍪 yt-dlp cookies-from-browser: ${cookiesBrowser}`);
    }
  }

  private logAuthConfigOnce(message: string): void {
    if (this.hasLoggedAuthConfig) return;
    console.log(message);
    this.hasLoggedAuthConfig = true;
  }

  private runYtdlpJson(args: string[], label: string): Promise<YtdlpResponse> {
    return new Promise((resolve, reject) => {
      const proc = this.spawnYtdlp(args);
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error(`yt-dlp ${label} timed out`));
      }, YTDLP_METADATA_TIMEOUT_MS);

      proc.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code !== 0) {
          reject(
            new Error(
              `yt-dlp ${label} failed (${code}): ${stderr.trim() || "no stderr"}`,
            ),
          );
          return;
        }

        try {
          resolve(JSON.parse(stdout) as YtdlpResponse);
        } catch (error) {
          reject(new Error(`yt-dlp ${label} returned invalid JSON`, { cause: error }));
        }
      });
    });
  }

  private runYtdlpJsonLines(
    args: string[],
    label: string,
  ): Promise<YtdlpEntry[]> {
    return new Promise((resolve, reject) => {
      const proc = this.spawnYtdlp(args);
      let raw = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error(`yt-dlp ${label} timed out`));
      }, YTDLP_METADATA_TIMEOUT_MS);

      proc.stdout?.on("data", (chunk) => {
        raw += chunk.toString();
      });
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const entries = raw
          .split("\n")
          .filter((line) => line.trim().startsWith("{"))
          .map((line) => this.parseJsonLine(line))
          .filter((entry): entry is YtdlpEntry => entry !== null);

        if (code !== 0 && entries.length === 0) {
          reject(
            new Error(
              `yt-dlp ${label} failed (${code}): ${stderr.trim() || "no stderr"}`,
            ),
          );
          return;
        }

        if (stderr.trim()) console.warn(`⚠️ yt-dlp ${label}:`, stderr.trim());
        resolve(entries);
      });
    });
  }

  private spawnYtdlp(args: string[]): ChildProcess {
    return spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
  }

  private parseJsonLine(line: string): YtdlpEntry | null {
    try {
      return JSON.parse(line) as YtdlpEntry;
    } catch {
      return null;
    }
  }

  private tracksFromResponse(response: YtdlpResponse): YtdlpTrack[] {
    const entries = Array.isArray(response.entries) ? response.entries : [];
    if (entries.length === 0) {
      const track = this.trackFromEntry(response);
      return track ? [track] : [];
    }

    return entries
      .map((entry) => this.trackFromEntry(entry as YtdlpEntry))
      .filter((track): track is YtdlpTrack => track !== null);
  }

  private trackFromEntry(entry: YtdlpEntry): YtdlpTrack | null {
    const rawId = typeof entry.id === "string" ? entry.id : undefined;
    const rawUrl = typeof entry.url === "string" ? entry.url : undefined;
    const webpageUrl =
      typeof entry.webpage_url === "string" ? entry.webpage_url : undefined;
    const originalUrl =
      typeof entry.original_url === "string" ? entry.original_url : undefined;

    const url = this.normalizeVideoUrl(webpageUrl ?? originalUrl ?? rawUrl, rawId);
    if (!url) return null;

    return {
      url,
      title: typeof entry.title === "string" ? entry.title : "Unknown",
      durationSec: this.parseDuration(entry.duration),
      channelName: this.parseChannelName(entry),
    };
  }

  private parseDuration(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0;
  }

  private parseChannelName(entry: YtdlpEntry): string | undefined {
    if (typeof entry.channel === "string" && entry.channel.length > 0) {
      return entry.channel;
    }
    if (typeof entry.uploader === "string" && entry.uploader.length > 0) {
      return entry.uploader;
    }
    return undefined;
  }

  private normalizeVideoUrl(
    rawUrl: string | undefined,
    rawId: string | undefined,
  ): string | null {
    if (rawUrl?.startsWith("http://") || rawUrl?.startsWith("https://")) {
      return rawUrl;
    }

    if (rawUrl?.startsWith("/watch")) {
      return `https://www.youtube.com${rawUrl}`;
    }

    const id = rawId ?? rawUrl;
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  }

  private isYouTubeUrl(input: string): boolean {
    return input.includes("youtube.com") || input.includes("youtu.be");
  }
}
