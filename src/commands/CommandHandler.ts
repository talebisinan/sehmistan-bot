import {
  ChatInputCommandInteraction,
  GuildMember,
  SlashCommandBuilder,
} from 'discord.js';
import { MusicService } from '../services/MusicService';

const musicServices = new Map<string, MusicService>();

function getOrCreateService(guildId: string): MusicService {
  if (!musicServices.has(guildId)) {
    musicServices.set(guildId, new MusicService());
  }
  return musicServices.get(guildId)!;
}

export const commands = [
  new SlashCommandBuilder()
    .setName('p')
    .setDescription('Play a song from YouTube')
    .addStringOption(option =>
      option
        .setName('query')
        .setDescription('Song name or YouTube URL')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('s')
    .setDescription('Skip the current song'),
  new SlashCommandBuilder()
    .setName('hi')
    .setDescription('agzina bokumu koyucam ha'),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction
) {
  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: '❌ You need to be in a voice channel!',
      ephemeral: true,
    });
  }

  const service = getOrCreateService(interaction.guildId!);

  try {
    switch (interaction.commandName) {
      case 'p': {
        const query = interaction.options.getString('query', true);
        await interaction.deferReply();
        
        const title = await service.play(voiceChannel, query);
        const queueLength = service.getQueueLength();
        
        if (queueLength > 0) {
          await interaction.editReply(
            `🎵 Added to queue: **${title}**\n📝 Position: ${queueLength + 1}`
          );
        } else {
          await interaction.editReply(`🎵 Now playing: **${title}**`);
        }
        break;
      }

      case 's': {
        const skipped = service.skip();
        await interaction.reply(
          skipped ? '⏭️ Skipped!' : '❌ Nothing to skip!'
        );
        break;
      }

      case 'hi': {
        await interaction.reply('agzina bokumu koyucam ha 😎');
        
        const url = 'https://youtu.be/P2vukW4dexQ?t=17';
        await service.play(voiceChannel, url);
        break;
      }
    }
  } catch (error) {
    console.error('Command error:', error);
    const reply = {
      content: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ephemeral: true,
    };
    
    if (interaction.deferred) {
      await interaction.editReply(reply);
    } else {
      await interaction.reply(reply);
    }
    }
}