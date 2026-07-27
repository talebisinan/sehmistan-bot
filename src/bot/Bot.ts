import {
  ActivityType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import type { config as Config } from "../config";
import type { CommandRegistry } from "./CommandRegistry";
import type { InteractionRouter } from "./InteractionRouter";

/**
 * Owns the Discord {@link Client}: wires gateway events to the command registry
 * and interaction router, registers guild slash commands, and logs in.
 */
export class Bot {
  private readonly client: Client;

  constructor(
    private readonly config: typeof Config,
    private readonly commands: CommandRegistry,
    private readonly router: InteractionRouter,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.registerEventHandlers();
  }

  /** Registers slash commands with Discord, then connects the gateway. */
  async start(): Promise<void> {
    await this.registerCommands();
    await this.client.login(this.config.token);
  }

  private registerEventHandlers(): void {
    this.client.once("clientReady", () => {
      console.log(`✅ Logged in as ${this.client.user?.tag}`);

      this.client.user?.setPresence({
        activities: [{ name: "/help", type: ActivityType.Listening }],
        status: "online",
      });

      for (const guild of this.client.guilds.cache.values()) {
        console.log(`📍 Connected to guild: ${guild.name} (${guild.id})`);
      }
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.commands.dispatch(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await this.router.routeStringSelect(interaction);
      } else if (interaction.isUserSelectMenu()) {
        await this.router.routeUserSelect(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.router.routeModal(interaction);
      }
    });
  }

  private async registerCommands(): Promise<void> {
    const rest = new REST().setToken(this.config.token);

    try {
      console.log("🔄 Registering slash commands...");

      if (this.config.guildIds.length === 0) {
        throw new Error(
          "Set GUILD_IDS in your .env, e.g. GUILD_IDS=server_id_1,server_id_2",
        );
      }

      const body = this.commands.toJSON();

      for (const guildId of this.config.guildIds) {
        await rest.put(
          Routes.applicationGuildCommands(this.config.clientId, guildId),
          { body },
        );
        console.log(`✅ Slash commands registered for guild ${guildId}`);
      }

      console.log("✅ Slash command registration complete!");
    } catch (error) {
      console.error("❌ Failed to register commands:", error);
    }
  }
}
