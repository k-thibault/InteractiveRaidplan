// Shared helpers for the dev check scripts (run with `npx tsx`).
import { readFileSync } from 'node:fs';
import type { Encounter } from '../src/encounters/Encounter';
import { Simulation } from '../src/simulation/Simulation';
import type { PlayerDriver } from '../src/simulation/PlayerDriver';
import { stepControlledPlayer } from '../src/input/ControlledMovement';
import { quantizeFacing, quantizePosition } from '../src/geometry/Quantize';

export const TICK_MS = 1000 / 60;

interface IndexEntry { id: string; file: string; }
const encounterIndex = JSON.parse(readFileSync(new URL('../public/encounters/index.json', import.meta.url), 'utf8')) as IndexEntry[];

/** Ids of every encounter in public/encounters/index.json, so new encounters are covered automatically. */
export const ENCOUNTER_IDS = encounterIndex.map((entry) => entry.id);

/** Loads an encounter by its index id (e.g. `dmu_p3` for crystals.json). */
export function loadEncounter(id: string): Encounter {
  const entry = encounterIndex.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown encounter id ${id}`);
  return JSON.parse(readFileSync(new URL(`../public/encounters/${entry.file}`, import.meta.url), 'utf8')) as Encounter;
}

/** Tiny deterministic generator so the script needs no dependencies and never touches Math.random. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

/** Random walk: pick one of 8 directions or standing still, hold it for 10-60 ticks. */
export function randomWalk(simulation: Simulation, playerId: string, seed: number): PlayerDriver {
  const next = lcg(seed ^ 0x5bd1e995);
  let ticksLeft = 0; let direction = { x: 0, y: 0 };
  return {
    step(_tick, deltaSeconds) {
      if (ticksLeft-- <= 0) {
        ticksLeft = 10 + Math.floor(next() * 50);
        const pick = Math.floor(next() * 9);
        direction = pick === 8 ? { x: 0, y: 0 } : { x: Math.cos(pick * Math.PI / 4), y: Math.sin(pick * Math.PI / 4) };
      }
      const player = simulation.state.players.find((candidate) => candidate.id === playerId)!;
      stepControlledPlayer(player, simulation.state.arena, { direction }, deltaSeconds);
    },
  };
}

export interface BotTrack { positions: Array<Record<string, { x: number; y: number; facing: number | undefined }>>; ruleActive: Array<Record<string, boolean>>; deaths: string; }

/** All-bots run recording, at the start of every tick, what each player looked like. */
export function recordBots(encounter: Encounter, seed: number): BotTrack {
  const simulation = new Simulation(encounter, { seed, replayOutcomes: new Map() });
  const track: BotTrack = { positions: [], ruleActive: [], deaths: '' };
  simulation.start();
  const maxTicks = Math.ceil(encounter.duration / TICK_MS) + 100;
  while (!simulation.state.completed && simulation.tickCount < maxTicks) {
    track.positions.push(Object.fromEntries(simulation.state.players.map((p) => [p.id, { x: p.position.x, y: p.position.y, facing: p.facing }])));
    simulation.tick(TICK_MS);
    track.ruleActive.push(Object.fromEntries(simulation.state.players.map((p) => [p.id, p.facingRuleActive === true])));
  }
  track.deaths = JSON.stringify(simulation.state.deaths.map((d) => [Math.round(d.time), d.playerId, d.source]));
  return track;
}

/** Puts the controlled slot where the bot was, tick by tick: a survivable stand-in for a human. */
export function ghostDriver(simulation: Simulation, playerId: string, track: BotTrack): PlayerDriver {
  return {
    step(tick) {
      const player = simulation.state.players.find((candidate) => candidate.id === playerId)!;
      const wanted = track.positions[tick]?.[playerId]; if (!wanted) return;
      player.position.x = wanted.x; player.position.y = wanted.y; quantizePosition(player.position);
      if (wanted.facing !== undefined) player.facing = quantizeFacing(wanted.facing);
    },
  };
}

