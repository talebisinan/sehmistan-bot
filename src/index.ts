import {
  ActivityType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import { config } from "./config";
import {
  commands,
  handleCommand,
  handleModalSubmit,
  handleSelectMenu,
  handleUserSelectMenu,
} from "./commands/CommandHandler";

process.on("warning", (warning) => {
  if (warning.name === "TimeoutNegativeWarning") return;
  console.warn(warning);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);

  client.user?.setPresence({
    activities: [
      {
        name: "/help",
        type: ActivityType.Listening,
      },
    ],
    status: "online",
  });

  for (const guild of client.guilds.cache.values()) {
    console.log(`📍 Connected to guild: ${guild.name} (${guild.id})`);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  } else if (interaction.isUserSelectMenu()) {
    await handleUserSelectMenu(interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
  }
});

async function registerCommands() {
  const rest = new REST().setToken(config.token);

  try {
    console.log("🔄 Registering slash commands...");

    if (config.guildIds.length === 0) {
      throw new Error(
        "Set GUILD_IDS in your .env, e.g. GUILD_IDS=server_id_1,server_id_2",
      );
    }

    const body = commands.map((cmd) => cmd.toJSON());

    for (const guildId of config.guildIds) {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, guildId),
        { body },
      );

      console.log(`✅ Slash commands registered for guild ${guildId}`);
    }

    console.log("✅ Slash command registration complete!");
  } catch (error) {
    console.error("❌ Failed to register commands:", error);
  }
}

await registerCommands();
client.login(config.token);
