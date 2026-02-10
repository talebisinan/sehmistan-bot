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
} from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import { search } from 'play-dl';
import { spawn } from 'child_process';

interface QueueItem {
  url: string;
  title: string;
}

export class MusicService {
  private queue: QueueItem[] = [];
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer | null = null;
  private isPlaying = false;

  async play(channel: VoiceBasedChannel, searchOrUrl: string) {
    const { url, title } = await this.resolveTrack(searchOrUrl);
    
    this.queue.push({ url, title });

    if (!this.connection) {
      this.connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });

      try {
        await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
        console.log('✅ Voice connection ready');
      } catch (error) {
        console.error('❌ Failed to establish voice connection');
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
        console.log('🎶 Audio started playing');
      });
      
      this.player.on('error', (error) => {
        console.error('❌ Player error:', error);
        this.isPlaying = false;
        this.playNext();
      });
    }

    if (!this.isPlaying) {
      this.playNext();
    }

    return title;
  }

  private async playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    const item = this.queue.shift()!;
    
    try {
      console.log(`🎵 Loading: ${item.title}`);
      
      // Use yt-dlp with flexible format selection
      const ytdlp = spawn('yt-dlp', [
        '-f', 'bestaudio/best',
        '-o', '-',
        '--no-playlist',
        '--extractor-args', 'youtube:player_client=android',
        item.url,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Simple ffmpeg transcoding
      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-fflags', '+nobuffer',
        '-flags', 'low_delay',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-loglevel', 'error',
        'pipe:1',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      ytdlp.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('ERROR')) {
          console.error('❌ yt-dlp error:', msg);
        }
      });

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        // Ignore cleanup errors that don't affect playback
        if (msg.includes('Error writing trailer') || 
            msg.includes('Error closing file') ||
            msg.includes('Error muxing a packet') ||
            msg.includes('Error submitting a packet')) {
          return;
        }
        if (msg.includes('Error') || msg.includes('error')) {
          console.error('❌ ffmpeg error:', msg);
        }
      });

      ytdlp.on('error', (error) => {
        console.error('❌ yt-dlp process error:', error);
        this.playNext();
      });

      ffmpeg.on('error', (error) => {
        console.error('❌ ffmpeg process error:', error);
        this.playNext();
      });

      ffmpeg.stdin.on('error', (error) => {
        // Ignore EPIPE errors - they're normal when the stream ends
        if (error.code !== 'EPIPE') {
          console.error('❌ ffmpeg stdin error:', error);
        }
      });

      ytdlp.stdout.on('error', (error) => {
        // Ignore EPIPE errors
        if (error.code !== 'EPIPE') {
          console.error('❌ yt-dlp stdout error:', error);
        }
      });

      ytdlp.stdout.pipe(ffmpeg.stdin);
      
      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
      });

      this.player!.play(resource);
      this.isPlaying = true;
      
      console.log(`▶️  Now playing: ${item.title}`);
      console.log(`🔊 Player state: ${this.player!.state.status}`);
      
    } catch (error) {
      console.error('❌ Playback error:', error);
      this.playNext();
    }
  }

  skip(): boolean {
    if (!this.isPlaying) return false;
    this.player!.stop();
    return true;
  }

  private async resolveTrack(searchOrUrl: string): Promise<{ url: string; title: string }> {
    // Check if it's already a URL
    if (searchOrUrl.includes('youtube.com') || searchOrUrl.includes('youtu.be')) {
      console.log('🔗 YouTube URL detected');
      return { url: searchOrUrl, title: 'YouTube Video' };
    }

    // Search for the video
    console.log(`🔍 Searching for: ${searchOrUrl}`);
    const searchResults = await search(searchOrUrl, {
      limit: 1,
      source: { youtube: 'video' },
    });

    if (searchResults.length === 0) {
      throw new Error('No results found');
    }

    const video = searchResults[0];
    if (!video || !video.url) {
      throw new Error('Invalid video result');
    }

    console.log(`✅ Found: ${video.title}`);
    
    return {
      url: video.url,
      title: video.title || 'Unknown',
    };
  }



  disconnect() {
    this.queue = [];
    this.isPlaying = false;
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