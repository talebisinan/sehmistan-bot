import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";

export interface JumpableTrack {
  url: string;
  title: string;
  duration?: string;
}

/** customId shared by the `/radio` reply and {@link QueueJumpSelectHandler}. */
export const QUEUE_JUMP_CUSTOM_ID = "queue-jump";

/**
 * Builds the "jump to a song" dropdown row from up to 25 tracks, or `null` when
 * there is nothing to jump to. Shared so `/radio` and the jump handler stay in
 * sync when rebuilding the menu.
 */
export function buildQueueJumpRow(
  tracks: JumpableTrack[],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const snapshot = tracks.slice(0, 25);
  if (snapshot.length === 0) return null;

  const options = snapshot.map((item, i) => {
    const opt: { label: string; value: string; description?: string } = {
      label: `${i + 1}. ${item.title}`.slice(0, 100),
      value: item.url,
    };
    if (item.duration) opt.description = `⏱️ ${item.duration}`;
    return opt;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(QUEUE_JUMP_CUSTOM_ID)
    .setPlaceholder("⏭️ Jump to a song…")
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
