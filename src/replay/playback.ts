import type { Encounter } from '../encounters/Encounter';
import { Simulation } from '../simulation/Simulation';
import { hashState, hashString } from './hash';
import { CHECKPOINT_INTERVAL_TICKS, SIM_VERSION, TICK_MS } from './format';
import { ReplayRecorder } from './ReplayRecorder';
import type { Replay } from './format';
import { ReplayDriver } from './ReplayDriver';

/** 32-bit content hash of an encounter definition; changes whenever its JSON changes. */
export function hashEncounter(encounter: Encounter): number { return hashString(JSON.stringify(encounter)); }

/** Problems found before playing: wrong encounter content or an older simulation. Playback still goes ahead. */
export function compatibilityWarnings(replay: Replay, encounter: Encounter, encounterId: string): string[] {
  const warnings: string[] = [];
  if (replay.header.encounterId !== encounterId) warnings.push(`Recorded on encounter "${replay.header.encounterId}", not "${encounterId}".`);
  if (replay.header.encounterHash !== hashEncounter(encounter)) warnings.push('The encounter file has changed since this was recorded.');
  if (replay.header.simVersion !== SIM_VERSION) warnings.push(`Recorded with simulation version ${replay.header.simVersion}; this build is ${SIM_VERSION}.`);
  return warnings;
}

export interface ReplaySession {
  simulation: Simulation;
  /** The outcome cache the simulation fills in as it plays; complete once playback reaches the end. */
  readonly outcomes: Map<string, Record<string, unknown>>;
  driver: ReplayDriver | undefined;
  /** Tick number of the first checkpoint that did not match, once playback reaches it. */
  readonly divergedAtTick: number | undefined;
  /** Advances one tick. Returns false once the recorded end has been reached. */
  advance(): boolean;
}

/** Builds a fresh simulation for a replay and returns a session that steps it tick by tick, verifying checkpoints on the way. */
export function createReplaySession(encounter: Encounter, replay: Replay): ReplaySession {
  const { header } = replay;
  const outcomes = new Map<string, Record<string, unknown>>(header.outcomes.map(([key, value]) => [key, structuredClone(value)]));
  const simulation = new Simulation(encounter, { seed: header.seed, controlledPlayerId: header.controlledPlayerId, replayOutcomes: outcomes });
  const player = simulation.state.players.find((candidate) => candidate.controlled);
  const driver = player ? new ReplayDriver(replay, player) : undefined;
  simulation.setDriver(driver);
  let divergedAtTick: number | undefined;
  simulation.onTickEnd = (tickCount) => {
    if (divergedAtTick !== undefined) return;
    const expected = tickCount % CHECKPOINT_INTERVAL_TICKS === 0 ? replay.checkpoints[tickCount / CHECKPOINT_INTERVAL_TICKS - 1] : tickCount === header.endTick ? replay.endHash : undefined;
    if (expected !== undefined && hashState(simulation.state) !== expected) divergedAtTick = tickCount;
  };
  simulation.start();
  return {
    simulation, driver, outcomes,
    get divergedAtTick() { return divergedAtTick; },
    advance() {
      if (simulation.tickCount >= header.endTick || simulation.state.completed) return false;
      simulation.tick(header.tickMs);
      return true;
    },
  };
}

/**
 * Runs an all-bots attempt for `seed` headlessly and returns it as a replay. Used to open a batch run's failed seed in the viewer:
 * no human input exists, so the seed is the whole recording.
 */
export function recordSeedReplay(encounter: Encounter, encounterId: string, seed: number): Replay {
  const simulation = new Simulation(encounter, { seed, replayOutcomes: new Map() });
  const recorder = new ReplayRecorder({ encounterId, encounterHash: hashEncounter(encounter), seed, outcomes: new Map(), tickMs: TICK_MS });
  recorder.attach(simulation, undefined);
  simulation.start();
  while (!simulation.state.completed) simulation.tick(TICK_MS);
  return recorder.finish();
}

/**
 * Every random outcome the recorded attempt resolved, as "keep previous RNG" would hold them after playing it: the run's starting
 * outcomes plus everything drawn along the way. Plays the replay headlessly to its end.
 */
export function finalOutcomes(encounter: Encounter, replay: Replay): Map<string, Record<string, unknown>> {
  const session = createReplaySession(encounter, replay);
  while (session.advance());
  return new Map([...session.outcomes].map(([key, value]) => [key, structuredClone(value)]));
}
