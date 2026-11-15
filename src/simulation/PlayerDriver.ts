/** Applies controlled-player input during a simulation step. */
export interface PlayerDriver {
  /** Advance one simulation tick. */
  step(tick: number, deltaSeconds: number): void;
  /** Optionally runs after the bots have moved, before the arena edge and tethers are resolved; `tick` is the tick just completed. */
  afterBots?(tick: number): void;
  /** Optionally apply input before the attempt starts. */
  idle?(deltaSeconds: number): void;
}
