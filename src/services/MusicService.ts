import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnection,
  AudioPlayer,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import { spawn } from 'child_process';
import { search } from 'play-dl';

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
      
      // Use yt-dlp to stream audio
      const stream = spawn('yt-dlp', [
        '-f', 'bestaudio',
        '-o', '-',
        '--no-playlist',
        '--no-warnings',
        '--extract-audio',
        '--audio-format', 'opus',
        item.url,
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const resource = createAudioResource(stream.stdout);

      this.player!.play(resource);
      this.isPlaying = true;
      
      console.log(`▶️  Now playing: ${item.title}`);
      
      stream.on('error', (error) => {
        console.error('❌ yt-dlp error:', error);
        this.playNext();
      });
      
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
      // Get title using yt-dlp
      const title = await this.getVideoTitle(searchOrUrl);
      return { url: searchOrUrl, title };
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

    const [video] = searchResults || [];
    if(video) {
      console.log(`✅ Found: ${video.title}`);
      
      return {
        url: video.url,
        title: video.title || 'Unknown',
      };
    }

    console.error('❌ Invalid video result');
    this.skip();
    return { url: '', title: 'Unknown' };


  }

  private async getVideoTitle(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('yt-dlp', ['--get-title', '--no-warnings', url]);
      let title = '';
      
      process.stdout.on('data', (data) => {
        title += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(title.trim() || 'Unknown');
        } else {
          resolve('Unknown');
        }
      });
      
      process.on('error', () => {
        resolve('Unknown');
      });
    });
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