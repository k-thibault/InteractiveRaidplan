// Check recording, serialization, playback, and divergence detection.
// Run with: npx tsx scripts/check-replay.ts [seedCount]
import { Simulation } from '../src/simulation/Simulation';
import type { PlayerDriver } from '../src/simulation/PlayerDriver';
import { parseReplay, serializeReplay } from '../src/replay/codec';
import { ReplayRecorder } from '../src/replay/ReplayRecorder';
import { compatibilityWarnings, createReplaySession, hashEncounter } from '../src/replay/playback';
import { ENCOUNTER_IDS, TICK_MS, ghostDriver, loadEncounter, randomWalk, recordBots } from './lib';

const seedCount = Number(process.argv[2] ?? 12);
let failures = 0; let runs = 0; let bytes = 0; let safetyNetHits = 0; let facingEntries = 0; let positionEntries = 0; let ticks = 0;
const fail = (message: string) => { failures += 1; console.error(`  FAIL ${message}`); };

type Mode = 'random-walk' | 'ghost' | 'bots-only';

function recordRun(name: string, seed: number, controlledId: string | undefined, mode: Mode, tweak?: (encounter: ReturnType<typeof loadEncounter>) => void) {
  const encounter = loadEncounter(name); tweak?.(encounter);
  const simulation = new Simulation(encounter, { seed, controlledPlayerId: controlledId, replayOutcomes: new Map() });
  let driver: PlayerDriver | undefined;
  if (controlledId && mode === 'random-walk') driver = randomWalk(simulation, controlledId, seed);
  if (controlledId && mode === 'ghost') driver = ghostDriver(simulation, controlledId, recordBots(encounter, seed));
  const recorder = new ReplayRecorder({ encounterId: name, encounterHash: hashEncounter(encounter), seed, outcomes: new Map(), tickMs: TICK_MS, warn: () => { safetyNetHits += 1; } });
  recorder.attach(simulation, driver);
  simulation.start();
  const live: string[] = [];
  const controlled = simulation.state.players.find((player) => player.controlled);
  while (!simulation.state.completed) { simulation.tick(TICK_MS); live.push(controlled ? `${controlled.position.x},${controlled.position.y}` : ''); }
  return { encounter, replay: recorder.finish(), live };
}

for (const name of ENCOUNTER_IDS) {
  const players = loadEncounter(name).players;
  let ok = 0; let total = 0;
  for (let index = 0; index < seedCount; index += 1) {
    const seed = (index + 1) * 31337;
    const mode: Mode = index % 3 === 0 ? 'random-walk' : index % 3 === 1 ? 'ghost' : 'bots-only';
    const controlledId = mode === 'bots-only' || players.length === 0 ? undefined : players[index % players.length].id;
    const { encounter, replay: recorded, live } = recordRun(name, seed, controlledId, mode);
    const text = serializeReplay(recorded); const replay = parseReplay(text);
    total += 1; runs += 1; bytes += text.length; ticks += replay.header.endTick; facingEntries += replay.facing.length / 2; positionEntries += replay.position.length / 3;
    const label = `${name} seed ${seed} ${mode} ${controlledId ?? 'bots'}`;
    if (JSON.stringify(replay) !== JSON.stringify(recorded)) { fail(`${label}: codec round trip changed the replay`); continue; }
    if (compatibilityWarnings(replay, encounter, name).length) fail(`${label}: unexpected compatibility warnings`);
    const session = createReplaySession(encounter, replay);
    const controlled = session.simulation.state.players.find((player) => player.controlled);
    let mismatchTick = -1;
    while (session.advance()) {
      const tick = session.simulation.tickCount - 1;
      if (controlled && mismatchTick < 0 && `${controlled.position.x},${controlled.position.y}` !== live[tick]) mismatchTick = tick;
    }
    if (session.divergedAtTick !== undefined) fail(`${label}: checkpoint diverged at tick ${session.divergedAtTick}`);
    else if (mismatchTick >= 0) fail(`${label}: controlled position differs at tick ${mismatchTick}`);
    else if (session.simulation.tickCount !== replay.header.endTick) fail(`${label}: replay ended at tick ${session.simulation.tickCount}, expected ${replay.header.endTick}`);
    else ok += 1;

    // Verifier sensitivity: nudge the first position entry (or change the seed for bots-only) and the replay must report a divergence.
    const tampered = parseReplay(text);
    // Replays with no controlled-player movement (deterministic bots-only runs) have nothing to tamper with.
    if (!tampered.position.length) continue;
    tampered.position[1] += 2000;
    const tamperedSession = createReplaySession(encounter, tampered);
    while (tamperedSession.advance() && tamperedSession.divergedAtTick === undefined);
    if (tamperedSession.divergedAtTick === undefined) fail(`${label}: tampered replay was not flagged`);
  }
  console.log(`${name}: ${ok}/${total} replays identical`);
}


/** Run one bot-track replay round trip. */
function ghostRoundTrip(name: string, seed: number, playerId: string, tweak?: (encounter: ReturnType<typeof loadEncounter>) => void) {
  const { encounter, replay: recorded, live } = recordRun(name, seed, playerId, 'ghost', tweak);
  const replay = parseReplay(serializeReplay(recorded));
  const session = createReplaySession(encounter, replay);
  const controlled = session.simulation.state.players.find((player) => player.controlled)!;
  let mismatch = -1;
  while (session.advance()) { const tick = session.simulation.tickCount - 1; if (mismatch < 0 && `${controlled.position.x},${controlled.position.y}` !== live[tick]) mismatch = tick; }
  return { replay, diverged: session.divergedAtTick, mismatch };
}

// Every crystals player, so every role's facing rules and facing-dependent mechanics are recorded and replayed.
let windowEntries = 0;
for (const player of loadEncounter('dmu_p3').players) {
  for (const seed of [11, 222, 3333]) {
    const result = ghostRoundTrip('dmu_p3', seed, player.id); windowEntries += result.replay.facing.length / 2;
    if (result.diverged !== undefined || result.mismatch >= 0) fail(`crystals ${player.id} seed ${seed}: replay differs (checkpoint ${result.diverged}, position ${result.mismatch})`);
  }
}
if (windowEntries === 0) fail('crystals sweep recorded no facing windows; the facing track is not being exercised');
console.log(`crystals sweep: every player x 3 seeds replayed identically (${windowEntries} facing entries)`);

// Safety net: strip every facing rule so facing-dependent mechanics read the controlled player's facing outside any window.
const hitsBefore = safetyNetHits; let netEntries = 0;
for (const player of loadEncounter('dmu_p3').players) {
  const result = ghostRoundTrip('dmu_p3', 11, player.id, (encounter) => { encounter.facing = {}; });
  netEntries += result.replay.facing.length / 2;
  if (result.diverged !== undefined || result.mismatch >= 0) fail(`safety net, crystals ${player.id}: replay differs (checkpoint ${result.diverged}, position ${result.mismatch})`);
}
if (safetyNetHits === hitsBefore) fail('safety net never fired with facing rules removed; the test is not exercising it');
console.log(`safety net: facing rules removed, ${safetyNetHits - hitsBefore} warnings, ${netEntries} isolated facing entries, all replays identical`);

// Changed content must be reported before playing.
const crystals = loadEncounter('dmu_p3');
const sample = recordRun('dmu_p3', 99, undefined, 'bots-only').replay;
crystals.duration += 1;
if (compatibilityWarnings(sample, crystals, 'dmu_p3').length === 0) fail('changed encounter was not reported');

console.log(`${runs} runs, ${ticks} ticks; avg ${(bytes / runs / 1024).toFixed(1)} KB serialised; ${positionEntries} position and ${facingEntries} facing entries; ${safetyNetHits} safety-net warnings`);
if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('replay check passed');
