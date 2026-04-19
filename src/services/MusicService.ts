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
import { search, video_info } from "play-dl";
import { spawn } from "child_process";

export interface QueueItem {
  url: string;
  title: string;
  requestedBy: string;
  duration?: string;
}

function formatDuration(seconds: number): string {
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

  async play(
    channel: VoiceBasedChannel,
    searchOrUrl: string,
    requestedBy: string = "Unknown",
  ): Promise<{ title: string; duration?: string }> {
    const { url, title, duration } = await this.resolveTrack(searchOrUrl);

    this.queue.push({ url, title, duration, requestedBy });

    if (!this.connection) {
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
        throw error;
      }

      this.player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      this.connection.subscribe(this.player);

      this.player.on(AudioPlayerStatus.Idle, () => {
        this.isPlaying = false;
        this.playNext();
      });

      this.player.on(AudioPlayerStatus.Playing, () => {
        console.log("🎶 Audio started playing");
      });

      this.player.on("error", (error) => {
        console.error("❌ Player error:", error);
        this.isPlaying = false;
        this.currentSong = null;
        this.playNext();
      });
    }

    if (!this.isPlaying) {
      this.playNext();
    }

    return { title, duration };
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.currentSong = null;
      return;
    }

    const item = this.queue.shift()!;

    try {
      console.log(`🎵 Loading: ${item.title}`);

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

      const ffmpeg = spawn(
        "ffmpeg",
        [
          "-i",
          "pipe:0",
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
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

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
  ): Promise<{ url: string; title: string; duration?: string }> {
    if (
      searchOrUrl.includes("youtube.com") ||
      searchOrUrl.includes("youtu.be")
    ) {
      console.log("🔗 YouTube URL detected");
      try {
        const info = await video_info(searchOrUrl);
        const title = info.video_details.title ?? "YouTube Video";
        const durationInSec = info.video_details.durationInSec;
        const duration =
          durationInSec > 0 ? formatDuration(durationInSec) : undefined;
        console.log(`✅ Found: ${title}`);
        return { url: searchOrUrl, title, duration };
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
    const duration =
      video.durationInSec > 0 ? formatDuration(video.durationInSec) : undefined;

    return {
      url: video.url,
      title: video.title ?? "Unknown",
      duration,
    };
  }

  getCurrentSong(): QueueItem | null {
    return this.currentSong;
  }

  getQueue(): QueueItem[] {
    return [...this.queue];
  }

  disconnect() {
    this.queue = [];
    this.isPlaying = false;
    this.currentSong = null;
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
