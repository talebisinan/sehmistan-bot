import type { YtdlpTrack } from "./YtdlpService";
import type { MusicSourceStrategy } from "./sources/MusicSourceStrategy";

export interface PlayableTrack extends YtdlpTrack {
  source?: "youtube";
  sourceTitle?: string;
}

export interface PlayableCollection {
  title: string;
  tracks: PlayableTrack[];
  failed: number;
  source: "youtube";
}

/**
 * Source-agnostic dispatcher that converts user input into playable tracks by
 * selecting the first registered source strategy that claims the input. YouTube
 * remains the default strategy so plain searches and other yt-dlp-supported URLs
 * continue to work without source-specific branching here.
 */
export class PlayableTrackResolver {
  constructor(
    private readonly strategies: MusicSourceStrategy[],
    private readonly defaultStrategyName = "youtube",
  ) {}

  async resolveTrack(input: string): Promise<PlayableTrack> {
    return this.findStrategy(input).resolveTrack(input);
  }

  async resolveCollection(input: string): Promise<PlayableCollection | null> {
    const strategy = this.findStrategy(input);
    return strategy.resolveCollection?.(input) ?? null;
  }

  private findStrategy(input: string): MusicSourceStrategy {
    return (
      this.strategies.find((strategy) => strategy.canHandle(input)) ??
      this.defaultStrategy()
    );
  }

  private defaultStrategy(): MusicSourceStrategy {
    const strategy = this.strategies.find(
      (candidate) => candidate.name === this.defaultStrategyName,
    );

    if (!strategy) {
      throw new Error(
        `No default music source strategy configured: ${this.defaultStrategyName}`,
      );
    }

    return strategy;
  }
}
