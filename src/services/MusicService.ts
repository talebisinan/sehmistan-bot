import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnection,
  AudioPlayer,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import { search, video_info, playlist_info } from "play-dl";
import { spawn, ChildProcess } from "child_process";

export interface QueueItem {
  url: string;
  title: string;
  requestedBy: string;
  duration?: string;
  durationSec?: number;
}

export interface SearchResult {
  url: string;
  title: string;
  duration?: string;
  durationSec: number;
  channelName?: string;
}

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class MusicService {
  private queue: QueueItem[] = [];
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private isPlaying = false;
  private currentSong: QueueItem | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private pendingSeek: number | null = null;
  private ytdlpProcess: ChildProcess | null = null;
  private ffmpegProcess: ChildProcess | null = null;

  async play(
    channel: VoiceBasedChannel,
    urlOrQuery: string,
    requestedBy: string = "Unknown",
  ): Promise<{ title: string; duration?: string; queued: number }> {
    if (this.isPlaylistUrl(urlOrQuery)) {
      return this.playPlaylist(channel, urlOrQuery, requestedBy);
    }

    const { url, title, duration, durationSec } = await this.resolveTrack(urlOrQuery);
    this.queue.push({ url, title, duration, durationSec, requestedBy });

    if (!this.connection) {
      await this.initConnection(channel);
    }

    if (!this.isPlaying) {
      this.playNext();
    }

    return { title, duration, queued: 1 };
  }

  private isPlaylistUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.includes("youtube.com") &&
        parsed.pathname === "/playlist" &&
        !!parsed.searchParams.get("list")
      );
    } catch {
      return false;
    }
  }

  private async playPlaylist(
    channel: VoiceBasedChannel,
    url: string,
    requestedBy: string,
  ): Promise<{ title: string; duration?: string; queued: number }> {
    const playlist = await playlist_info(url, { incomplete: true });
    const allVideos = await playlist.all_videos();
    const videos = allVideos.slice(0, 100);

    if (videos.length === 0) throw new Error("Playlist is empty or unavailable");

    for (const v of videos) {
      if (!v.url || !v.title) continue;
      this.queue.push({
        url: v.url,
        title: v.title,
        requestedBy,
        duration: v.durationInSec > 0 ? formatDuration(v.durationInSec) : undefined,
        durationSec: v.durationInSec,
      });
    }

    if (!this.connection) {
      await this.initConnection(channel);
    }

    if (!this.isPlaying) {
      this.playNext();
    }

    const first = videos[0]!;
    return {
      title: first.title ?? "Unknown",
      duration: first.durationInSec > 0 ? formatDuration(first.durationInSec) : undefined,
      queued: videos.length,
    };
  }

  async searchTracks(query: string): Promise<SearchResult[]> {
    const results = await search(query, { limit: 5, source: { youtube: "video" } });
    return results
      .filter((v) => v.url && v.title)
      .map((v) => ({
        url: v.url,
        title: v.title ?? "Unknown",
        duration: v.durationInSec > 0 ? formatDuration(v.durationInSec) : undefined,
        durationSec: v.durationInSec,
        channelName: v.channel?.name,
      }));
  }

  seek(seconds: number): boolean {
    if (!this.currentSong || !this.player) return false;
    this.pendingSeek = seconds;
    this.queue.unshift(this.currentSong);
    this.player.stop();
    return true;
  }

  private async initConnection(channel: VoiceBasedChannel): Promise<void> {
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
      console.log("✅ Voice connection ready");
    } catch (error) {
      console.error("❌ Failed to establish voice connection");
      this.connection.destroy();
      this.connection = null;
      throw error;
    }

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.isPlaying = false;
      const seekSec = this.pendingSeek ?? 0;
      this.pendingSeek = null;
      this.playNext(seekSec);
    });

    this.player.on(AudioPlayerStatus.Playing, () => {
      console.log("🎶 Audio started playing");
    });

    this.player.on("error", (error) => {
      console.error("❌ Player error:", error);
      this.isPlaying = false;
      this.currentSong = null;
      this.pendingSeek = null;
      this.playNext();
    });
  }

  private killCurrentProcesses(): void {
    if (this.ytdlpProcess) {
      this.ytdlpProcess.kill("SIGKILL");
      this.ytdlpProcess = null;
    }
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill("SIGKILL");
      this.ffmpegProcess = null;
    }
  }

  private startIdleTimer(): void {
    this.idleTimer = setTimeout(() => {
      console.log("💤 Idle timeout — disconnecting");
      this.disconnect();
    }, IDLE_TIMEOUT_MS);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private async playNext(seekSeconds = 0): Promise<void> {
    this.cancelIdleTimer();

    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.currentSong = null;
      this.startIdleTimer();
      return;
    }

    const item = this.queue.shift()!;

    try {
      console.log(`🎵 Loading: ${item.title}`);

      this.killCurrentProcesses();

      const ytdlpArgs: string[] = [
        "-f",
        "bestaudio/best",
        "-o",
        "-",
        "--no-playlist",
        "--extractor-args",
        "youtube:player_client=android,tv_embedded",
      ];

      const cookiesBrowser = process.env.YTDLP_COOKIES_BROWSER;
      if (cookiesBrowser) {
        ytdlpArgs.push("--cookies-from-browser", cookiesBrowser);
      }

      ytdlpArgs.push(item.url);

      const ytdlp = spawn("yt-dlp", ytdlpArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.ytdlpProcess = ytdlp;

      const ffmpegArgs: string[] = ["-i", "pipe:0"];

      if (seekSeconds > 0) {
        ffmpegArgs.push("-ss", String(seekSeconds));
      }

      ffmpegArgs.push(
        "-fflags",
        "+nobuffer",
        "-flags",
        "low_delay",
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-loglevel",
        "error",
        "pipe:1",
      );

      const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.ffmpegProcess = ffmpeg;

      ytdlp.stderr!.on("data", (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes("ERROR")) {
          console.error("❌ yt-dlp error:", msg);
        }
      });

      ffmpeg.stderr!.on("data", (data: Buffer) => {
        const msg = data.toString();
        if (
          msg.includes("Error writing trailer") ||
          msg.includes("Error closing file") ||
          msg.includes("Error muxing a packet") ||
          msg.includes("Error submitting a packet")
        ) {
          return;
        }
        if (msg.includes("Error") || msg.includes("error")) {
          console.error("❌ ffmpeg error:", msg);
        }
      });

      ytdlp.on("error", (error) => {
        console.error("❌ yt-dlp process error:", error);
        this.currentSong = null;
        this.playNext();
      });

      ffmpeg.on("error", (error) => {
        console.error("❌ ffmpeg process error:", error);
        this.currentSong = null;
        this.playNext();
      });

      ffmpeg.stdin!.on("error", (error: Error) => {
        if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
          console.error("❌ ffmpeg stdin error:", error);
        }
      });

      ytdlp.stdout!.on("error", (error: Error) => {
        if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
          console.error("❌ yt-dlp stdout error:", error);
        }
      });

      ytdlp.stdout!.pipe(ffmpeg.stdin!);

      const resource = createAudioResource(ffmpeg.stdout!, {
        inputType: StreamType.Raw,
      });

      this.currentSong = item;
      this.player!.play(resource);
      this.isPlaying = true;

      console.log(`▶️  Now playing: ${item.title}`);
      console.log(`🔊 Player state: ${this.player!.state.status}`);
    } catch (error) {
      console.error("❌ Playback error:", error);
      this.currentSong = null;
      this.playNext();
    }
  }

  skip(): boolean {
    if (!this.isPlaying) return false;
    this.player!.stop();
    return true;
  }

  private async resolveTrack(
    searchOrUrl: string,
  ): Promise<{ url: string; title: string; duration?: string; durationSec?: number }> {
    if (
      searchOrUrl.includes("youtube.com") ||
      searchOrUrl.includes("youtu.be")
    ) {
      console.log("🔗 YouTube URL detected");
      try {
        const info = await video_info(searchOrUrl);
        const title = info.video_details.title ?? "YouTube Video";
        const durationSec = info.video_details.durationInSec;
        const duration = durationSec > 0 ? formatDuration(durationSec) : undefined;
        console.log(`✅ Found: ${title}`);
        return { url: searchOrUrl, title, duration, durationSec };
      } catch (error) {
        console.error("⚠️ Failed to fetch video info:", error);
        return { url: searchOrUrl, title: "YouTube Video" };
      }
    }

    console.log(`🔍 Searching for: ${searchOrUrl}`);
    const searchResults = await search(searchOrUrl, {
      limit: 1,
      source: { youtube: "video" },
    });

    if (searchResults.length === 0) {
      throw new Error("No results found");
    }

    const video = searchResults[0];
    if (!video || !video.url) {
      throw new Error("Invalid video result");
    }

    console.log(`✅ Found: ${video.title}`);
    const durationSec = video.durationInSec;
    const duration = durationSec > 0 ? formatDuration(durationSec) : undefined;

    return {
      url: video.url,
      title: video.title ?? "Unknown",
      duration,
      durationSec,
    };
  }

  getCurrentSong(): QueueItem | null {
    return this.currentSong;
  }

  getQueue(): QueueItem[] {
    return [...this.queue];
  }

  disconnect() {
    this.cancelIdleTimer();
    this.killCurrentProcesses();
    this.queue = [];
    this.isPlaying = false;
    this.currentSong = null;
    this.pendingSeek = null;
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
    this.player = null;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
