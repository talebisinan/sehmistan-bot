import { config } from "./config";
import { Bot } from "./bot/Bot";
import { CommandRegistry } from "./bot/CommandRegistry";
import { InteractionRouter } from "./bot/InteractionRouter";
import type { SlashCommand } from "./core/SlashCommand";

// Services (dependencies)
import { MusicServiceRegistry } from "./services/MusicServiceRegistry";
import { PlayableTrackResolver } from "./services/PlayableTrackResolver";
import { YouTubeSourceStrategy } from "./services/sources/YouTubeSourceStrategy";
import { YtdlpService } from "./services/YtdlpService";
import { VoiceGuard } from "./services/VoiceGuard";
import { WalkService } from "./services/WalkService";
import { DisconnectService } from "./services/DisconnectService";

// Commands
import { PlayCommand } from "./commands/PlayCommand";
import { PlaylistSearchCommand } from "./commands/PlaylistSearchCommand";
import { SkipCommand } from "./commands/SkipCommand";
import { StopCommand } from "./commands/StopCommand";
import { SeekCommand } from "./commands/SeekCommand";
import { QueueCommand } from "./commands/QueueCommand";
import { RadioCommand } from "./commands/RadioCommand";
import { KufurCommand } from "./commands/KufurCommand";
import { CleanCommand } from "./commands/CleanCommand";
import { BamCommand } from "./commands/BamCommand";
import { BamBamCommand } from "./commands/BamBamCommand";
import { TakeWalkCommand } from "./commands/TakeWalkCommand";
import { LotteryCommand } from "./commands/LotteryCommand";
import { PermsCommand } from "./commands/PermsCommand";
import { HelpCommand } from "./commands/HelpCommand";

// Interaction handlers
import { MusicSearchSelectHandler } from "./interactions/MusicSearchSelectHandler";
import { QueueJumpSelectHandler } from "./interactions/QueueJumpSelectHandler";
import { TakeWalkUserSelectHandler } from "./interactions/TakeWalkUserSelectHandler";
import { TakeWalkModalHandler } from "./interactions/TakeWalkModalHandler";

process.on("warning", (warning) => {
  if (warning.name === "TimeoutNegativeWarning") return;
  console.warn(warning);
});

// ── Composition root ────────────────────────────────────────────────────────
// Everything is wired here by hand: no DI container, no module-level singletons.
// Dependencies flow inward via constructors.

const ytdlpService = new YtdlpService();
const playableResolver = new PlayableTrackResolver([
  new YouTubeSourceStrategy(ytdlpService),
]);
const musicRegistry = new MusicServiceRegistry(playableResolver, ytdlpService);
const voiceGuard = new VoiceGuard();
const walkService = new WalkService();
const disconnectService = new DisconnectService();

const commands: SlashCommand[] = [
  new PlayCommand(voiceGuard),
  new PlaylistSearchCommand(voiceGuard),
  new SkipCommand(voiceGuard),
  new StopCommand(voiceGuard),
  new SeekCommand(voiceGuard),
  new QueueCommand(),
  new RadioCommand(voiceGuard),
  new KufurCommand(),
  new CleanCommand(),
  new BamCommand(voiceGuard, disconnectService),
  new BamBamCommand(voiceGuard, disconnectService),
  new TakeWalkCommand(voiceGuard, walkService),
  new LotteryCommand(),
  new PermsCommand(walkService),
  new HelpCommand(),
];

const commandRegistry = new CommandRegistry(commands, voiceGuard, musicRegistry);

const interactionRouter = new InteractionRouter({
  stringSelect: [
    new MusicSearchSelectHandler(musicRegistry, voiceGuard),
    new QueueJumpSelectHandler(musicRegistry),
  ],
  userSelect: [new TakeWalkUserSelectHandler(walkService)],
  modal: [new TakeWalkModalHandler(musicRegistry, walkService)],
});

const bot = new Bot(config, commandRegistry, interactionRouter);
await bot.start();
