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

type PrefetchEntry = {
  url: string;
  path: string;
  ready: boolean;
  ytdlp: ChildProcess;
  ffmpeg: ChildProcess;
};

/** 2 seconds of raw PCM @ 48 kHz, stereo, 16-bit = 192 000 * 2 bytes */
const INITIAL_BUFFER_BYTES = 192_000 * 2;
const PREFILL_TIMEOUT_MS = 8_000;
const MAX_PLAY_ATTEMPTS = 2;


export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Waits until the PassThrough has at least INITIAL_BUFFER_BYTES of data
 * buffered before returning, so the player never starts on an empty stream.
 * Resolves early if the stream ends/errors (yt-dlp failure fast path),
 * and always resolves after PREFILL_TIMEOUT_MS at the latest.
 */
function waitForInitialBuffer(stream: PassThrough): Promise<void> {
  return new Promise<void>((resolve) => {
    if (stream.readableLength >= INITIAL_BUFFER_BYTES) {
      resolve();
      return;
    }

    let resolved = false;
    const cleanup = (reason?: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      stream.removeListener("readable", onReadable);
      stream.removeListener("error", onErr);
      stream.removeListener("end", onDone);
      stream.removeListener("close", onDone);
      if (reason) console.warn(`⚠️  Pre-fill: ${reason}`);
      resolve();
    };

    const timer = setTimeout(
      () => cleanup("timeout — starting with partial buffer"),
      PREFILL_TIMEOUT_MS,
    );
    // The readable event fires in paused mode whenever new data is pushed into
    // the internal buffer, so we check readableLength on each arrival.
    const onReadable = () => {
      if (stream.readableLength >= INITIAL_BUFFER_BYTES) cleanup();
    };
    const onErr  = () => cleanup("stream error");
    const onDone = () => cleanup("stream ended before buffer was full");

    stream.on("readable", onReadable);
    stream.on("error",    onErr);
    stream.on("end",      onDone);
    stream.on("close",    onDone);
  });
}

export class MusicService {
  private queue: QueueItem[] = [];
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private isPlaying = false;
  /** Guards against concurrent playNext() calls (e.g. during await waitForInitialBuffer). */
  private isLoadingNext = false;
  /** Guards against concurrent reconnect attempts. */
  private isReconnecting = false;
  /** Set by jumpTo() when a song is being buffered — tells playNext to abort the current load. */
  private abortLoad = false;
  private currentSong: QueueItem | null = null;
  /** Stored so the reconnect handler can rejoin the same channel. */
  private voiceChannel: VoiceBasedChannel | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private pendingSeek: number | null = null;
  private ytdlpProcess: ChildProcess | null = null;
  private ffmpegProcess: ChildProcess | null = null;
  private currentFileStream: ReturnType<typeof createReadStream> | null = null;
  /** Keyed by video URL; supports pre-fetching the next 2 songs simultaneously. */
  private prefetchCache = new Map<string, PrefetchEntry>();
  /** Tracks per-URL play attempt counts for the retry logic. */
  private playAttempts = new Map<string, number>();

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


  async startRadio(
    channel: VoiceBasedChannel,
    queryOrUrl: string | null,
    requestedBy: string,
  ): Promise<{ seedTitle: string; queued: number; tracks: Array<{ url: string; title: string; duration?: string }> }> {
    let seedUrl: string;
    let seedTitle: string;

    if (!queryOrUrl) {
      const current = this.getCurrentSong();
      if (!current) throw new Error("Nothing is playing. Provide a song name to start the radio.");
      seedUrl = current.url;
      seedTitle = current.title;
    } else {
      const resolved = await this.resolveTrack(queryOrUrl);
      seedUrl = resolved.url;
      seedTitle = resolved.title;
    }

    const videoId = this.extractVideoId(seedUrl);
    if (!videoId) throw new Error("Could not extract a YouTube video ID to seed the radio.");

    const tracks = await this.fetchRadioTracks(videoId, 25);

    // Filter out the seed song if it is already playing.
    const currentUrl = this.getCurrentSong()?.url;
    const filtered = tracks.filter((t) => t.url !== currentUrl);

    if (filtered.length === 0) throw new Error("Radio returned no tracks. Try a different song.");

    const queueItems = filtered.map((t) =>
      this.createQueueItem(t.url, t.title, t.durationSec, requestedBy),
    );

    for (const item of queueItems) {
      this.queue.push(item);
    }

    await this.ensurePlayback(channel);

    // Return the snapshot captured BEFORE ensurePlayback shifted items off the queue.
    return {
      seedTitle,
      queued: queueItems.length,
      tracks: queueItems.map((item) => ({
        url: item.url,
        title: item.title,
        duration: item.duration,
      })),
    };
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


  private extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes("youtube.com")) {
        return parsed.searchParams.get("v");
      } else if (parsed.hostname === "youtu.be") {
        return parsed.pathname.slice(1).split("?")[0] ?? null;
      }
    } catch {}
    return null;
  }

  private fetchRadioTracks(
    videoId: string,
    limit = 25,
  ): Promise<Array<{ url: string; title: string; durationSec: number }>> {
    return new Promise((resolve, reject) => {
      const radioUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
      const args = [
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--playlist-end", String(limit),
        radioUrl,
      ];
      const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

      let raw = "";
      proc.stdout!.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
      proc.stderr!.on("data", (chunk: Buffer) => {
        const msg = chunk.toString();
        if (msg.trim()) console.warn("⚠️ yt-dlp radio:", msg.trim());
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        const tracks = raw
          .split("\n")
          .filter((l) => l.trim().startsWith("{"))
          .map((l) => {
            try {
              const obj = JSON.parse(l) as { id?: string; title?: string; duration?: number };
              if (!obj.id || !obj.title) return null;
              return {
                url: `https://www.youtube.com/watch?v=${obj.id}`,
                title: obj.title,
                durationSec: obj.duration ?? 0,
              };
            } catch {
              return null;
            }
          })
          .filter((t): t is { url: string; title: string; durationSec: number } => t !== null);

        if (code !== 0 && tracks.length === 0) {
          reject(new Error(`yt-dlp exited with code ${code} and returned no tracks`));
        } else {
          resolve(tracks);
        }
      });
    });
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
    this.voiceChannel = channel;

    const conn = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    try {
      await entersState(conn, VoiceConnectionStatus.Ready, 30_000);
      console.log("✅ Voice connection ready");
    } catch (error) {
      console.error("❌ Failed to establish voice connection");
      conn.destroy();
      throw error;
    }

    this.connection = conn;
    this.setupConnectionListeners(conn);

    if (!this.player) {
      this.player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
      });
      this.setupPlayerListeners();
    }

    this.connection.subscribe(this.player);
  }

  private setupConnectionListeners(conn: VoiceConnection): void {
    conn.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.isReconnecting) return;
      this.isReconnecting = true;

      try {
        await Promise.race([
          entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
          entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        console.log("🔄 Voice reconnecting automatically…");
        this.isReconnecting = false;
      } catch {
        console.warn("⚠️  Voice connection lost — attempting to rejoin…");
        conn.destroy();
        if (this.connection === conn) this.connection = null;

        const ch = this.voiceChannel;
        if (ch) {
          try {
            await this.initConnection(ch);
            console.log("✅ Rejoined voice channel");
          } catch (err) {
            console.error("❌ Could not rejoin voice channel:", err);
            this.isPlaying = false;
            this.currentSong = null;
          }
        } else {
          this.isPlaying = false;
        }
        this.isReconnecting = false;
      }
    });
  }

  private setupPlayerListeners(): void {
    if (!this.player) return;

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
      this.isLoadingNext = false;
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
    if (!this.isPlaying && !this.isLoadingNext) this.playNext();
  }

  private buildFfmpegArgs(seekSeconds: number): string[] {
    const args = ["-i", "pipe:0"];
    if (seekSeconds > 0) args.push("-ss", String(seekSeconds));
    args.push(
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
    if (this.prefetchCache.has(item.url)) return;

    const tmpPath = join(
      tmpdir(),
      `sehmistan-${Date.now()}-${Math.random().toString(36).slice(2)}.pcm`,
    );
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

    const entry: PrefetchEntry = { url: item.url, path: tmpPath, ready: false, ytdlp, ffmpeg };
    this.prefetchCache.set(item.url, entry);

    ffmpeg.on("close", (code) => {
      if (this.prefetchCache.get(item.url) !== entry) return;
      if (code === 0) {
        entry.ready = true;
        console.log(`📦 Prefetched: ${item.title}`);
      } else {
        this.cancelPrefetchFor(item.url);
      }
    });

    ytdlp.on("error", () => this.cancelPrefetchFor(item.url));
    ffmpeg.on("error", () => this.cancelPrefetchFor(item.url));
  }

  private cancelPrefetchFor(url: string): void {
    const entry = this.prefetchCache.get(url);
    if (!entry) return;
    this.prefetchCache.delete(url);
    entry.ytdlp.kill("SIGKILL");
    entry.ffmpeg.kill("SIGKILL");
    unlink(entry.path, () => {});
  }

  private cancelAllPrefetches(): void {
    for (const url of [...this.prefetchCache.keys()]) {
      this.cancelPrefetchFor(url);
    }
  }

  private setupProcessHandlers(ytdlp: ChildProcess, ffmpeg: ChildProcess): void {
    const onFatal = (name: string) => (err: Error) => {
      console.error(`❌ ${name} process error:`, err);
      this.currentSong = null;
    };
    const onStream = (name: string) => (err: Error) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE")
        console.error(`❌ ${name} stream error:`, err);
    };

    ytdlp.on("error", onFatal("yt-dlp"));
    ffmpeg.on("error", onFatal("ffmpeg"));
    ffmpeg.stdin!.on("error", onStream("ffmpeg stdin"));
    ytdlp.stdout!.on("error", onStream("yt-dlp stdout"));
  }

  private async playNext(seekSeconds = 0): Promise<void> {
    if (this.isLoadingNext) return;
    this.isLoadingNext = true;
    this.cancelIdleTimer();

    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.currentSong = null;
      this.isLoadingNext = false;
      this.startIdleTimer();
      return;
    }

    const item = this.queue.shift()!;

    try {
      console.log(`🎵 Loading: ${item.title}`);
      this.killCurrentProcesses();

      const prefetched = this.prefetchCache.get(item.url);
      if (prefetched?.ready) {
        this.prefetchCache.delete(item.url);

        const startByte = seekSeconds > 0 ? seekSeconds * 192_000 : 0;
        const fileStream = createReadStream(prefetched.path, {
          start: startByte,
          highWaterMark: 10 * 1024 * 1024,
        });
        this.currentFileStream = fileStream;

        const cleanupFile = () => unlink(prefetched.path, () => {});
        fileStream.on("close", cleanupFile);
        fileStream.on("error", cleanupFile);

        const resource = createAudioResource(fileStream, { inputType: StreamType.Raw });
        this.currentSong = item;
        this.playAttempts.delete(item.url);
        this.player!.play(resource);
        this.isPlaying = true;
        this.isLoadingNext = false;
        console.log(`▶️  Now playing (buffered): ${item.title}`);

      } else {
        if (this.prefetchCache.has(item.url)) this.cancelPrefetchFor(item.url);

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

        const buffer = new PassThrough({ highWaterMark: 10 * 1024 * 1024 });
        ffmpeg.stdout!.pipe(buffer);

        await waitForInitialBuffer(buffer);

        // jumpTo() may have been called while we were buffering — abort this load
        // and let playNext() restart cleanly with the new head of queue.
        if (this.abortLoad) {
          this.abortLoad = false;
          this.killCurrentProcesses();
          this.isLoadingNext = false;
          setTimeout(() => this.playNext(), 0);
          return;
        }

        const resource = createAudioResource(buffer, { inputType: StreamType.Raw });
        this.currentSong = item;
        this.playAttempts.delete(item.url);
        this.player!.play(resource);
        this.isPlaying = true;
        this.isLoadingNext = false;
        console.log(`▶️  Now playing: ${item.title}`);
      }

      console.log(`🔊 Player state: ${this.player!.state.status}`);

      const nextUrls = this.queue.slice(0, 2).map((i) => i.url);
      for (const url of this.prefetchCache.keys()) {
        if (!nextUrls.includes(url)) this.cancelPrefetchFor(url);
      }
      for (const next of this.queue.slice(0, 2)) {
        this.startPrefetch(next);
      }

    } catch (error) {
      console.error("❌ Playback error:", error);
      this.killCurrentProcesses();
      this.currentSong = null;

      const attempts = (this.playAttempts.get(item.url) ?? 0) + 1;
      if (attempts < MAX_PLAY_ATTEMPTS) {
        console.log(`🔄 Retrying "${item.title}" (attempt ${attempts + 1}/${MAX_PLAY_ATTEMPTS})`);
        this.playAttempts.set(item.url, attempts);
        this.queue.unshift(item);
        this.isLoadingNext = false;
        setTimeout(() => this.playNext(), 2_000);
      } else {
        console.log(`⏭️  Giving up on "${item.title}" after ${attempts} attempt(s)`);
        this.playAttempts.delete(item.url);
        this.isLoadingNext = false;
        setTimeout(() => this.playNext(), 0);
      }
    }
  }

  skip(): boolean {
    if (!this.isPlaying) return false;
    this.player!.stop();
    return true;
  }
  jumpTo(url: string): string | null {
    const idx = this.queue.findIndex((item) => item.url === url);
    if (idx === -1) return null;
    const target = this.queue[idx]!;
    this.queue.splice(0, idx); // target is now at queue[0]

    if (this.isLoadingNext) {
      // playNext is suspended inside await waitForInitialBuffer — set the abort flag
      // so it cleans up and re-runs, picking up the target from queue[0].
      this.abortLoad = true;
    } else if (this.isPlaying) {
      // Normal case: a song is playing => stop it => Idle fires => playNext picks up target.
      this.player?.stop();
    } else {
      // Nothing is playing or loading — kick off playback directly.
      this.playNext();
    }

    return target.title;
  }
  stop(): boolean {
    const hadAnything = this.isPlaying || this.queue.length > 0;
    this.queue = [];
    this.cancelAllPrefetches();
    this.abortLoad = false;
    if (this.isPlaying) this.player?.stop();
    return hadAnything;
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

  disconnect(): void {
    this.cancelIdleTimer();
    this.cancelAllPrefetches();
    this.killCurrentProcesses();
    this.queue = [];
    this.isPlaying = false;
    this.isLoadingNext = false;
    this.isReconnecting = false;
    this.abortLoad = false;
    this.currentSong = null;
    this.pendingSeek = null;
    this.voiceChannel = null;
    this.playAttempts.clear();
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
