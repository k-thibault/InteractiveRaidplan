// Check deterministic movement and parity between controlled-player and bot runs.
// Run with: npx tsx scripts/check-foundation.ts [seedCount]
import type { Encounter } from '../src/encounters/Encounter';
import { Simulation } from '../src/simulation/Simulation';
import { toPositionUnits, fromPositionUnits, toFacingUnits, fromFacingUnits } from '../src/geometry/Quantize';
import { ENCOUNTER_IDS, TICK_MS, loadEncounter, randomWalk, recordBots, ghostDriver } from './lib';
import type { BotTrack } from './lib';

const seedCount = Number(process.argv[2] ?? 20);

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  return value >>> 0;
}

function snapshot(simulation: Simulation): string {
  const { players, enemies, time } = simulation.state;
  return JSON.stringify([time, players.map((p) => [p.id, p.position, p.facing, p.health, p.alive, p.statuses.length]), enemies.map((e) => [e.id, e.position, e.facing])]);
}

interface RunResult { checkpoints: number[]; final: number; ticks: number; reads: number; readsOutsideRule: number; ruleTicks: number; offGrid: number; }

function run(encounter: Encounter, seed: number, controlledId: string): RunResult {
  const simulation = new Simulation(encounter, { seed, controlledPlayerId: controlledId, replayOutcomes: new Map() });
  simulation.setDriver(randomWalk(simulation, controlledId, seed));
  const controlled = simulation.state.players.find((player) => player.id === controlledId)!;
  const result: RunResult = { checkpoints: [], final: 0, ticks: 0, reads: 0, readsOutsideRule: 0, ruleTicks: 0, offGrid: 0 };
  simulation.state.onFacingRead = (player) => { result.reads += 1; if (!player.facingRuleActive) result.readsOutsideRule += 1; };
  simulation.start();
  const maxTicks = Math.ceil(encounter.duration / TICK_MS) + 100;
  while (!simulation.state.completed && simulation.tickCount < maxTicks) {
    simulation.tick(TICK_MS);
    if (controlled.facingRuleActive) result.ruleTicks += 1;
    // Grid check after each tick's driver step is only meaningful when no knock has moved the player since, so test the snapshot inside the next step instead.
    if (simulation.tickCount % 60 === 0) result.checkpoints.push(hash(snapshot(simulation)));
  }
  result.final = hash(snapshot(simulation)); result.ticks = simulation.tickCount;
  const { x, y } = controlled.position;
  if (fromPositionUnits(toPositionUnits(x)) !== x && !controlled.knock) result.offGrid += 1;
  if (fromPositionUnits(toPositionUnits(y)) !== y && !controlled.knock) result.offGrid += 1;
  if (controlled.facing !== undefined && fromFacingUnits(toFacingUnits(controlled.facing)) !== controlled.facing) result.offGrid += 1;
  return result;
}

/** The controlled slot fed the bot's own track must reproduce the all-bots outcome, and `facingRuleActive` must match the bot's tick for tick. */
const ghostReads = { total: 0, outsideRule: 0 };
function ghostParity(encounter: Encounter, seed: number, playerId: string, track: BotTrack): string[] {
  const problems: string[] = [];
  const simulation = new Simulation(encounter, { seed, controlledPlayerId: playerId, replayOutcomes: new Map() });
  simulation.setDriver(ghostDriver(simulation, playerId, track));
  simulation.state.onFacingRead = (player) => { ghostReads.total += 1; if (!player.facingRuleActive) ghostReads.outsideRule += 1; };
  const controlled = simulation.state.players.find((player) => player.id === playerId)!;
  simulation.start();
  let firstFlagMismatch = -1;
  while (!simulation.state.completed && simulation.tickCount < track.ruleActive.length) {
    simulation.tick(TICK_MS);
    if (firstFlagMismatch < 0 && (controlled.facingRuleActive === true) !== track.ruleActive[simulation.tickCount - 1][playerId]) firstFlagMismatch = simulation.tickCount - 1;
  }
  const deaths = JSON.stringify(simulation.state.deaths.map((d) => [Math.round(d.time), d.playerId, d.source]));
  if (deaths !== track.deaths) problems.push(`deaths differ (bots ${track.deaths} vs ghost ${deaths})`);
  if (firstFlagMismatch >= 0) problems.push(`facingRuleActive differs from tick ${firstFlagMismatch}`);
  return problems;
}

let failures = 0;
for (const name of ENCOUNTER_IDS) {
  const encounter = loadEncounter(name);
  let reads = 0; let outside = 0; let ruleTicks = 0; let identical = 0;
  for (let index = 0; index < seedCount; index += 1) {
    const seed = (index + 1) * 7919;
    // Rotate through every player so each role's facing rules and facing-dependent mechanics get exercised.
    const controlledId = encounter.players[index % encounter.players.length].id;
    const first = run(encounter, seed, controlledId); const second = run(encounter, seed, controlledId);
    const same = first.final === second.final && first.checkpoints.length === second.checkpoints.length && first.checkpoints.every((value, i) => value === second.checkpoints[i]);
    if (same) identical += 1; else { failures += 1; console.error(`  MISMATCH ${name} seed ${seed}`); }
    if (first.offGrid > 0) { failures += 1; console.error(`  OFF-GRID ${name} seed ${seed}`); }
    reads += first.reads; outside += first.readsOutsideRule; ruleTicks += first.ruleTicks;
  }
  console.log(`${name}: ${identical}/${seedCount} seeds bit-identical; controlled facing reads ${reads} (${outside} outside a facing rule); ticks with facing rule active ${ruleTicks}`);
}

for (const name of ENCOUNTER_IDS) {
  const encounter = loadEncounter(name);
  let checked = 0; let ruleSeen = 0;
  for (let index = 0; index < Math.max(2, Math.floor(seedCount / 4)); index += 1) {
    const seed = (index + 1) * 104729; const track = recordBots(encounter, seed);
    for (const player of encounter.players) {
      const problems = ghostParity(encounter, seed, player.id, track); checked += 1;
      ruleSeen += track.ruleActive.filter((tick) => tick[player.id]).length;
      if (problems.length) { failures += 1; console.error(`  GHOST ${name} seed ${seed} ${player.id}: ${problems.join('; ')}`); }
    }
  }
  console.log(`${name}: ghost parity ${checked} player runs checked (${ruleSeen} rule-active ticks compared); controlled facing reads ${ghostReads.total}, ${ghostReads.outsideRule} outside a facing rule`);
  ghostReads.total = 0; ghostReads.outsideRule = 0;
}
if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('foundation check passed');
