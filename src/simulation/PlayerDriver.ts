/** Applies controlled-player input during a simulation step. */
export interface PlayerDriver {
  /** Advance one simulation tick. */
  step(tick: number, deltaSeconds: number): void;
  /** Optionally apply input before the attempt starts. */
  idle?(deltaSeconds: number): void;
}
