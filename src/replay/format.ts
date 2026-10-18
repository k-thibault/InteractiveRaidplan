import type { RunFlags } from '../streak/StreakTypes';

/** Increment when simulation behavior changes so older recordings warn before playback. */
export const SIM_VERSION = 2;
export const REPLAY_FORMAT_VERSION = 1;
/** One checkpoint hash per this many ticks (one simulated second at 60 ticks per second). */
export const CHECKPOINT_INTERVAL_TICKS = 60;
/** Fixed simulation step in milliseconds (60 ticks per second). */
export const TICK_MS = 1000 / 60;

export interface ReplayHeader {
  formatVersion: number;
  simVersion: number;
  encounterId: string;
  /** 32-bit content hash of the encounter definition the run was recorded against. */
  encounterHash: number;
  seed: number;
  /** `replayOutcomes` as they stood when the run started (the live map is mutated during the run). */
  outcomes: Array<[string, Record<string, unknown>]>;
  /** Id of the player the human controlled; undefined for a seed-only all-bots replay. */
  controlledPlayerId?: string;
  /** Display name of the controlled player, for listings. */
  controlledPlayerName?: string;
  /** Streak-affecting options in force when the attempt ended; absent for all-bots runs and older files. */
  runFlags?: RunFlags;
  tickMs: number;
  /** Number of running ticks recorded. */
  endTick: number;
  /** Human-readable summary of how the attempt ended. */
  result: { completed: boolean; /** The attempt ended because everyone died; absent in files from before wipes ended runs. */ failed?: boolean; deaths: Array<{ time: number; playerId: string; source: string }> };
  /** Rolled random groups and cast choices, readable metadata only (playback re-derives them from the seed). */
  rolls: Record<string, string>;
  /** Position of the controlled player (grid units) just before tick 0; the base for the first position delta. */
  startUnits: { x: number; y: number };
}

/**
 * In-memory replay. Tracks are flat integer arrays:
 * - `position`: repeating `[tickDelta, dx, dy]` in position grid units, one entry per tick where the grid position changed.
 * - `facing`: repeating `[tickDelta, value]`; `value` 0 means "not tracked from this tick" (hide the arrow), otherwise facing grid units + 1.
 * - `checkpoints`: one unsigned 32-bit hash per `CHECKPOINT_INTERVAL_TICKS`, taken at the end of that tick.
 */
export interface Replay {
  header: ReplayHeader;
  position: number[];
  facing: number[];
  checkpoints: number[];
  /** Hash of the final state at `endTick`. */
  endHash: number;
}
