import type {
  PlayableCollection,
  PlayableTrack,
} from "../PlayableTrackResolver";

export interface MusicSourceStrategy {
  readonly name: string;

  /** Returns true when this strategy owns the given input. */
  canHandle(input: string): boolean;

  /** Resolves a single playable track from this source. */
  resolveTrack(input: string): Promise<PlayableTrack>;

  /** Resolves a playable collection, or null when the input is not a collection. */
  resolveCollection?(input: string): Promise<PlayableCollection | null>;
}
