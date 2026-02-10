import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { config } from './config';
import { commands, handleCommand } from './commands/CommandHandler';

// Suppress TimeoutNegativeWarning from discord.js voice (harmless streaming latency)
process.on('warning', (warning) => {
  if (warning.name === 'TimeoutNegativeWarning') {
    return; // Ignore this specific warning
  }
  console.warn(warning);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

async function registerCommands() {
  const rest = new REST().setToken(config.token);
  
  try {
    console.log('🔄 Registering slash commands...');
    
    await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands.map(cmd => cmd.toJSON()) }
    );
    
    console.log('✅ Slash commands registered!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
}

await registerCommands();
client.login(config.token);