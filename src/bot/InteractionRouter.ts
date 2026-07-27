import type {
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import type {
  ModalHandler,
  StringSelectHandler,
  UserSelectHandler,
} from "../core/interactions";

export interface ComponentHandlers {
  stringSelect: StringSelectHandler[];
  userSelect: UserSelectHandler[];
  modal: ModalHandler[];
}

/**
 * Dispatches component interactions to the first handler whose `matches`
 * returns true. Replaces the customId `if/else` chains that were embedded in
 * the old handler module.
 */
export class InteractionRouter {
  constructor(private readonly handlers: ComponentHandlers) {}

  async routeStringSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    await this.handlers.stringSelect
      .find((handler) => handler.matches(interaction.customId))
      ?.handle(interaction);
  }

  async routeUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    await this.handlers.userSelect
      .find((handler) => handler.matches(interaction.customId))
      ?.handle(interaction);
  }

  async routeModal(interaction: ModalSubmitInteraction): Promise<void> {
    await this.handlers.modal
      .find((handler) => handler.matches(interaction.customId))
      ?.handle(interaction);
  }
}
