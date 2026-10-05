import type { Encounter } from '../encounters/Encounter';
import type { DeathRecord } from '../simulation/GameState';
import { Simulation } from '../simulation/Simulation';

/** Same step the live game uses, so a seed plays out identically here and in the arena. */
export const LIVE_TICK_MS = 1000 / 60;

export interface BatchOptions {
  /** Keep simulating after the first death to collect every death in the attempt. Slower for failing seeds. */
  runToEnd: boolean;
  tickMs?: number;
}

/** What one headless attempt produced. */
export interface RunOutcome {
  seed: number;
  /** Reached the end of the timeline (false when stopped at the first death). */
  completed: boolean;
  deaths: DeathRecord[];
  /** Rolled random groups and cast choices, as short labels. */
  rolls: Record<string, string>;
  /** Set when the simulation threw; the attempt is excluded from pass/fail. */
  error?: string;
}

/**
 * Seed for attempt number `index` of a batch. Consecutive seeds (1, 2, 3...) give near-identical first rolls in the
 * generator, so the batch spreads its seeds with an integer hash instead. The result is an ordinary seed that can be replayed in the arena.
 */
export function deriveSeed(batchSeed: number, index: number): number {
  let hash = (batchSeed ^ Math.imul(index + 1, 0x9e3779b9)) | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) | 0;
}

/** Runs one all-bots attempt of the encounter without rendering. */
export function runSeed(encounter: Encounter, seed: number, options: BatchOptions): RunOutcome {
  const tickMs = options.tickMs ?? LIVE_TICK_MS;
  try {
    const simulation = new Simulation(encounter, { seed, replayOutcomes: new Map() });
    simulation.start();
    // The guard keeps a stuck timeline from spinning forever.
    const maxTicks = Math.ceil(encounter.duration / tickMs) + 100;
    for (let tick = 0; tick < maxTicks && !simulation.state.completed; tick += 1) {
      simulation.tick(tickMs);
      if (!options.runToEnd && simulation.state.deaths.length > 0) break;
    }
    if (!simulation.state.completed && simulation.state.deaths.length === 0) return { seed, completed: false, deaths: [], rolls: {}, error: 'did not reach the end of the timeline' };
    return {
      seed, completed: simulation.state.completed, deaths: simulation.state.deaths,
      rolls: { ...simulation.rolledChoices, ...simulation.state.rolls },
    };
  } catch (error) {
    return { seed, completed: false, deaths: [], rolls: {}, error: error instanceof Error ? error.message : String(error) };
  }
}
