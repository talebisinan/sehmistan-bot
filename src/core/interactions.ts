import type {
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from "discord.js";

/**
 * A handler for a non-command interaction (select menu or modal). Each handler
 * claims the interactions it owns via {@link matches} against the customId,
 * keeping routing declarative and colocated with the handler.
 */
interface ComponentHandler<TInteraction> {
  /** Returns true when this handler owns the given interaction customId. */
  matches(customId: string): boolean;
  handle(interaction: TInteraction): Promise<void>;
}

export type StringSelectHandler = ComponentHandler<StringSelectMenuInteraction>;
export type UserSelectHandler = ComponentHandler<UserSelectMenuInteraction>;
export type ModalHandler = ComponentHandler<ModalSubmitInteraction>;
