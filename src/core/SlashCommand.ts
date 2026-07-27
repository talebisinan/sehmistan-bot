import type {
  ChatInputCommandInteraction,
  GuildMember,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { MusicService } from "../services/MusicService";

/**
 * Per-request context handed to every command. The dispatcher resolves the
 * guild member and the guild's {@link MusicService} once, so commands never
 * repeat that boilerplate.
 */
export interface CommandContext {
  readonly interaction: ChatInputCommandInteraction;
  readonly member: GuildMember;
  readonly music: MusicService;
}

/**
 * A single slash command. Implementations own their builder (`data`) and their
 * behaviour (`execute`). One command per file; dependencies arrive via the
 * constructor (see the composition root in `index.ts`).
 */
export interface SlashCommand {
  /** The Discord slash-command definition. Only `name` + `toJSON` are consumed. */
  readonly data: {
    readonly name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };

  /** Runs the command. Thrown errors are caught and surfaced by the dispatcher. */
  execute(ctx: CommandContext): Promise<void>;
}
