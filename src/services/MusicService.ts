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
import { createReadStream, unlink } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";

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
  private currentFileStream: ReturnType<typeof createReadStream> | null = null;
  private prefetch: {
    url: string;
    path: string;
    ready: boolean;
    ytdlp: ChildProcess;
    ffmpeg: ChildProcess;
  } | null = null;

  async play(
    channel: VoiceBasedChannel,
    urlOrQuery: string,
    requestedBy: string = "Unknown",
  ): Promise<{ title: string; duration?: string; queued: number }> {
    if (this.isPlaylistUrl(urlOrQuery)) {
      return this.playPlaylist(channel, urlOrQuery, requestedBy);
    }

    const { url, title, durationSec = 0 } = await this.resolveTrack(urlOrQuery);
    const item = this.createQueueItem(url, title, durationSec, requestedBy);
    this.queue.push(item);
    await this.ensurePlayback(channel);
    return { title: item.title, duration: item.duration, queued: 1 };
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
      this.queue.push(this.createQueueItem(v.url, v.title, v.durationInSec, requestedBy));
    }

    await this.ensurePlayback(channel);

    const first = this.createQueueItem(
      videos[0]!.url,
      videos[0]!.title ?? "Unknown",
      videos[0]!.durationInSec,
      requestedBy,
    );
    return { title: first.title, duration: first.duration, queued: videos.length };
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
    if (this.currentFileStream) {
      this.currentFileStream.destroy();
      this.currentFileStream = null;
    }
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

  private createQueueItem(
    url: string,
    title: string,
    durationSec: number,
    requestedBy: string,
  ): QueueItem {
    return {
      url,
      title,
      requestedBy,
      duration: durationSec > 0 ? formatDuration(durationSec) : undefined,
      durationSec,
    };
  }

  private async ensurePlayback(channel: VoiceBasedChannel): Promise<void> {
    if (!this.connection) await this.initConnection(channel);
    if (!this.isPlaying) this.playNext();
  }

  private buildFfmpegArgs(seekSeconds: number): string[] {
    const args = ["-i", "pipe:0"];
    if (seekSeconds > 0) args.push("-ss", String(seekSeconds));
    args.push(
      "-fflags", "+nobuffer",
      "-flags", "low_delay",
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "-loglevel", "error",
      "pipe:1",
    );
    return args;
  }

  private buildYtdlpArgs(url: string): string[] {
    const args = [
      "-f", "bestaudio/best",
      "-o", "-",
      "--no-playlist",
      "--extractor-args", "youtube:player_client=android,tv_embedded",
    ];
    const cookiesBrowser = process.env.YTDLP_COOKIES_BROWSER;
    if (cookiesBrowser) args.push("--cookies-from-browser", cookiesBrowser);
    args.push(url);
    return args;
  }

  private startPrefetch(item: QueueItem): void {
    if (this.prefetch?.url === item.url) return;
    this.cancelPrefetch();

    const tmpPath = join(tmpdir(), `sehmistan-${Date.now()}.pcm`);
    const ytdlp = spawn("yt-dlp", this.buildYtdlpArgs(item.url), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ffmpeg = spawn(
      "ffmpeg",
      ["-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "-loglevel", "error", tmpPath],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    ytdlp.stdout!.pipe(ffmpeg.stdin!);
    ytdlp.stdout!.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EPIPE") console.error("❌ prefetch yt-dlp stdout error:", e);
    });
    ffmpeg.stdin!.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EPIPE") console.error("❌ prefetch ffmpeg stdin error:", e);
    });

    this.prefetch = { url: item.url, path: tmpPath, ready: false, ytdlp, ffmpeg };

    ffmpeg.on("close", (code) => {
      if (this.prefetch?.url === item.url) {
        if (code === 0) {
          this.prefetch.ready = true;
          console.log(`📦 Prefetched: ${item.title}`);
        } else {
          this.cancelPrefetch();
        }
      }
    });
    ytdlp.on("error", () => this.cancelPrefetch());
    ffmpeg.on("error", () => this.cancelPrefetch());
  }

  private cancelPrefetch(): void {
    if (!this.prefetch) return;
    const { ytdlp, ffmpeg, path: tmpPath } = this.prefetch;
    this.prefetch = null;
    ytdlp.kill("SIGKILL");
    ffmpeg.kill("SIGKILL");
    unlink(tmpPath, () => {});
  }

  private setupProcessHandlers(ytdlp: ChildProcess, ffmpeg: ChildProcess): void {
    const onFatal = (name: string) => (err: Error) => {
      console.error(`❌ ${name} process error:`, err);
      this.currentSong = null;
      this.playNext();
    };
    const onStream = (name: string) => (err: Error) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE")
        console.error(`❌ ${name} error:`, err);
    };

    ytdlp.on("error", onFatal("yt-dlp"));
    ffmpeg.on("error", onFatal("ffmpeg"));
    ffmpeg.stdin!.on("error", onStream("ffmpeg stdin"));
    ytdlp.stdout!.on("error", onStream("yt-dlp stdout"));
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

      // Play from pre-fetched PCM file if ready.
      // PCM is constant bitrate (192 000 bytes/sec) so seeks are a byte offset.
      if (this.prefetch?.url === item.url && this.prefetch.ready) {
        const prefetchPath = this.prefetch.path;
        this.prefetch = null;

        const startByte = seekSeconds > 0 ? seekSeconds * 192_000 : 0;
        const fileStream = createReadStream(prefetchPath, {
          start: startByte,
          highWaterMark: 10 * 1024 * 1024,
        });
        this.currentFileStream = fileStream;
        fileStream.on("close", () => unlink(prefetchPath, () => {}));

        const resource = createAudioResource(fileStream, { inputType: StreamType.Raw });
        this.currentSong = item;
        this.player!.play(resource);
        this.isPlaying = true;
        console.log(`▶️  Now playing (buffered): ${item.title}`);
      } else {
        // Prefetch in-progress for this song is now redundant — cancel it.
        if (this.prefetch?.url === item.url) this.cancelPrefetch();

        const ytdlp = spawn("yt-dlp", this.buildYtdlpArgs(item.url), {
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.ytdlpProcess = ytdlp;

        const ffmpeg = spawn("ffmpeg", this.buildFfmpegArgs(seekSeconds), {
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.ffmpegProcess = ffmpeg;

        ytdlp.stderr!.on("data", (data: Buffer) => {
          const msg = data.toString();
          if (msg.includes("ERROR")) console.error("❌ yt-dlp error:", msg);
        });

        ffmpeg.stderr!.on("data", (data: Buffer) => {
          const msg = data.toString();
          if (
            msg.includes("Error writing trailer") ||
            msg.includes("Error closing file") ||
            msg.includes("Error muxing a packet") ||
            msg.includes("Error submitting a packet")
          ) return;
          if (msg.includes("Error") || msg.includes("error"))
            console.error("❌ ffmpeg error:", msg);
        });

        this.setupProcessHandlers(ytdlp, ffmpeg);
        ytdlp.stdout!.pipe(ffmpeg.stdin!);

        // 10 MB in-memory buffer so brief network hiccups don't stall the player.
        const buffer = new PassThrough({ highWaterMark: 10 * 1024 * 1024 });
        ffmpeg.stdout!.pipe(buffer);

        const resource = createAudioResource(buffer, { inputType: StreamType.Raw });
        this.currentSong = item;
        this.player!.play(resource);
        this.isPlaying = true;
        console.log(`▶️  Now playing: ${item.title}`);
      }

      console.log(`🔊 Player state: ${this.player!.state.status}`);

      // Kick off background download of the next song while this one plays.
      if (this.queue.length > 0) this.startPrefetch(this.queue[0]!);
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
    this.cancelPrefetch();
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
