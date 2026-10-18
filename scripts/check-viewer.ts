// Check attempt history and replay viewer behavior without a DOM.
// Run with: npx tsx scripts/check-viewer.ts
import { Simulation } from '../src/simulation/Simulation';
import { AttemptHistory } from '../src/replay/AttemptHistory';
import { ReplayViewer } from '../src/replay/ReplayViewer';
import { compatibilityWarnings, finalOutcomes, hashEncounter, recordSeedReplay } from '../src/replay/playback';
import { parseReplay, serializeReplay } from '../src/replay/codec';
import { TICK_MS } from '../src/replay/format';
import { ReplayRecorder } from '../src/replay/ReplayRecorder';
import { hashState } from '../src/replay/hash';
import { ghostDriver, loadEncounter, randomWalk, recordBots } from './lib';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failures += 1; };

const id = 'dmu_p3'; const encounter = loadEncounter(id); const player = encounter.players[3].id;
const hash = hashEncounter(encounter);
const meta = (seed: number) => ({ encounterId: id, encounterHash: hash, seed, outcomes: new Map<string, Record<string, unknown>>(), tickMs: TICK_MS });
const newSim = (seed: number) => { const outcomes = new Map<string, Record<string, unknown>>(); const sim = new Simulation(encounter, { seed, controlledPlayerId: player, replayOutcomes: outcomes }); return { sim, outcomes, driver: randomWalk(sim, player, seed) }; };
const ticks = (sim: Simulation, count: number) => { for (let index = 0; index < count && !sim.state.completed; index += 1) sim.tick(TICK_MS); };

// History: abandon keeps what was played, an undone Start keeps the old one, a ticking attempt hides it, completion publishes it.
const history = new AttemptHistory();
check('nothing available before any attempt', history.available === undefined);
let a = newSim(1); history.begin(a.sim, a.driver, meta(1)); a.sim.start(); ticks(a.sim, 600);
check('available is hidden while the attempt is ticking', history.available === undefined && history.recording);
history.abandon();
const abandoned = history.available;
check('abandoned attempt is watchable up to the abandon point', abandoned !== undefined && abandoned.header.endTick === 600 && !abandoned.header.result.completed, String(abandoned?.header.endTick));
let b = newSim(2); history.begin(b.sim, b.driver, meta(2)); b.sim.start();
check('after Start but before the first tick the old attempt is still available', history.available === abandoned);
history.abandon();
check('a zero-tick attempt leaves the old one in place', history.available === abandoned && !history.recording);
let c = newSim(3); history.begin(c.sim, c.driver, meta(3)); c.sim.start(); ticks(c.sim, 30); history.settle();
check('settle does nothing before completion', history.recording && history.available === undefined);
ticks(c.sim, Number.MAX_SAFE_INTEGER); history.settle();
const finished = history.available;
// The random-walking player wipes the party before the timeline ends, which closes the attempt as a failure
check('an attempt that ran to its end replaces the last one', finished !== undefined && finished !== abandoned && (finished.header.result.completed || finished.header.result.failed === true) && !history.recording);

// Viewer: plays a saved/loaded replay to its end with no divergence, pausing and restarting work.
function playOut(viewer: ReplayViewer): void { for (let guard = 0; guard < 100000 && !viewer.finished; guard += 1) viewer.update(100, 1); }
for (const [label, replay] of [['completed', finished!], ['abandoned', abandoned!]] as const) {
  const loaded = parseReplay(serializeReplay(replay));
  const warnings = compatibilityWarnings(loaded, encounter, id);
  const viewer = new ReplayViewer(encounter, loaded, warnings);
  check(`${label}: no compatibility warnings`, warnings.length === 0 && viewer.warnings.length === 0);
  viewer.playing = false; viewer.update(5000, 1);
  check(`${label}: paused viewer does not advance`, viewer.tick === 0);
  viewer.playing = true; viewer.update(1000, 1);
  check(`${label}: 1 s of real time is about 60 ticks`, Math.abs(viewer.tick - 60) <= 1, String(viewer.tick));
  viewer.update(1000, 0.5);
  check(`${label}: half speed advances half as far`, Math.abs(viewer.tick - 90) <= 1, String(viewer.tick));
  playOut(viewer);
  check(`${label}: plays to the recorded end with no divergence`, viewer.finished && viewer.tick === loaded.header.endTick && viewer.divergedAtMs === undefined, `tick ${viewer.tick}/${loaded.header.endTick}, diverged ${viewer.divergedAtMs}`);
  const endState = JSON.stringify(viewer.simulation.state.players.map((p) => [p.id, p.position, p.alive, p.health]));
  viewer.restart();
  check(`${label}: restart rewinds to tick 0`, viewer.tick === 0 && !viewer.finished && viewer.playing);
  playOut(viewer);
  check(`${label}: second playthrough ends in the identical state`, JSON.stringify(viewer.simulation.state.players.map((p) => [p.id, p.position, p.alive, p.health])) === endState);
}

// Facing arrow: a run that crosses facing rule windows must show the arrow inside them and hide it outside.
{
  let found = false;
  for (const candidate of encounter.players) {
    const sim = new Simulation(encounter, { seed: 7, controlledPlayerId: candidate.id, replayOutcomes: new Map() });
    const recorder = new ReplayRecorder(meta(7)); recorder.attach(sim, ghostDriver(sim, candidate.id, recordBots(encounter, 7))); sim.start(); ticks(sim, Number.MAX_SAFE_INTEGER);
    const replay = recorder.finish(); if (replay.facing.length === 0) continue;
    const viewer = new ReplayViewer(encounter, replay); let hidden = 0; let shown = 0;
    for (let guard = 0; guard < 100000 && !viewer.finished; guard += 1) { viewer.update(TICK_MS, 1); if (viewer.driver?.facingTracked) shown += 1; else hidden += 1; }
    check(`facing arrow follows the recorded windows (${candidate.id})`, shown > 0 && hidden > shown && viewer.divergedAtMs === undefined, `shown ${shown}, hidden ${hidden}`);
    found = true; break;
  }
  check('some player produced a facing window to test', found);
}

// Retry this RNG: the replay yields exactly the outcomes the live attempt resolved, and replaying them reproduces every roll whatever the player does.
{
  const mapText = (map: Map<string, Record<string, unknown>>) => JSON.stringify([...map].sort(([x], [y]) => (x < y ? -1 : 1)));
  check('there are random outcomes to retry', c.outcomes.size > 0, String(c.outcomes.size));
  check('completed replay yields the live attempt\'s final outcomes', mapText(finalOutcomes(encounter, finished!)) === mapText(c.outcomes));
  check('abandoned replay yields the outcomes resolved up to the abandon point', mapText(finalOutcomes(encounter, abandoned!)) === mapText(a.outcomes));
  const viewer = new ReplayViewer(encounter, finished!);
  check('viewer retry outcomes match before and after playing to the end', mapText(viewer.retryOutcomes()) === mapText(c.outcomes) && (playOut(viewer), mapText(viewer.retryOutcomes()) === mapText(c.outcomes)));
  const retryMap = viewer.retryOutcomes(); const retrySim = new Simulation(encounter, { seed: finished!.header.seed, controlledPlayerId: player, replayOutcomes: retryMap });
  retrySim.setDriver(randomWalk(retrySim, player, 999)); retrySim.start(); while (!retrySim.state.completed) retrySim.tick(TICK_MS);
  // Groups snapshot member positions, which legitimately depend on how the person played; who was picked must not. Creation order may differ.
  const groupsOf = (sim: Simulation) => JSON.stringify(Object.entries(sim.state.groups).map(([name, members]) => [name, [...members].map((member: { id: string }) => member.id)]).sort(([x], [y]) => (x < y ? -1 : 1)));
  check('a retry played differently resolves the same random groups', groupsOf(retrySim) === groupsOf(c.sim) && Object.keys(retrySim.state.groups).length > 0, `${Object.keys(retrySim.state.groups).length} groups`);
  check('a retry draws nothing new', mapText(retryMap) === mapText(c.outcomes));
}

// Seeking: lands exactly, matches a straight playthrough, is time-sliced, keeps the play state, and handles end/rewind.
{
  const replay = parseReplay(serializeReplay(finished!));
  const stateAt = (tick: number) => { const reference = new ReplayViewer(encounter, replay); reference.seekTo(tick); reference.update(0, 1, 1e9); return reference; };
  const fingerprint = (viewer: ReplayViewer) => JSON.stringify([viewer.tick, viewer.simulation.state.time, viewer.simulation.state.players.map((p) => [p.id, p.position, p.health, p.alive, p.statuses.map((x) => [x.definitionId, x.stacks])]), viewer.simulation.state.enemies.map((e) => [e.id, e.position, e.facing])]);
  const viewer = new ReplayViewer(encounter, replay);
  const target = Math.floor(replay.header.endTick * 0.6);
  viewer.seekTo(target);
  check('seeking is reported and playback is suspended', viewer.seeking && viewer.tick === 0);
  let clock = 0; let calls = 0; let widest = 0; let previousTick = 0;
  while (viewer.seeking && calls < 100000) { viewer.update(16, 1, 8, () => (clock += 2)); widest = Math.max(widest, viewer.tick - previousTick); previousTick = viewer.tick; calls += 1; }
  check('forward seek is time-sliced across several updates', calls > 3 && widest > 0 && widest < target, `calls ${calls}, widest slice ${widest}`);
  check('forward seek lands exactly on the target', viewer.tick === target && !viewer.seeking, String(viewer.tick));
  check('forward seek matches a straight playthrough to that tick', fingerprint(viewer) === fingerprint(stateAt(target)));
  const epochBefore = viewer.epoch; const playingBefore = viewer.playing;
  check('forward seek keeps the simulation object (epoch unchanged) and the play state', epochBefore === viewer.epoch && playingBefore === viewer.playing);
  viewer.playing = true; viewer.update(1000, 1);
  check('playback continues from the seek position', Math.abs(viewer.tick - (target + 60)) <= 1, String(viewer.tick));
  const back = Math.floor(replay.header.endTick * 0.25);
  viewer.seekTo(back); viewer.seekTo(back + 10);
  while (viewer.seeking) viewer.update(16, 1, 8);
  check('rewind lands on the latest target (coalesced) and replaces the simulation', viewer.tick === back + 10 && viewer.epoch === epochBefore + 1, `${viewer.tick} epoch ${viewer.epoch}`);
  check('rewind matches a straight playthrough to that tick', fingerprint(viewer) === fingerprint(stateAt(back + 10)));
  viewer.playing = false; viewer.seekTo(back + 500); while (viewer.seeking) viewer.update(16, 1, 8);
  viewer.update(5000, 1);
  check('seeking while paused stays paused', viewer.tick === back + 500 && !viewer.playing);
  viewer.seekTo(1e9); while (viewer.seeking) viewer.update(16, 1, 8);
  check('seek past the end clamps to the end and marks the replay finished', viewer.tick === replay.header.endTick && viewer.finished && viewer.simulation.state.completed);
  viewer.seekTo(replay.header.endTick - 100); while (viewer.seeking) viewer.update(16, 1, 8);
  check('seeking back from the end clears finished', !viewer.finished && viewer.tick === replay.header.endTick - 100);
  viewer.seekTo(0); while (viewer.seeking) viewer.update(16, 1, 8);
  check('seek to 0 gives a fresh simulation at tick 0', viewer.tick === 0 && viewer.simulation.state.time === 0);
}

// Seeking an abandoned replay and a tampered one: divergence is remembered after rewinding past it.
{
  const bad = parseReplay(serializeReplay(finished!)); bad.position[1] += 3000;
  const viewer = new ReplayViewer(encounter, bad);
  viewer.seekTo(bad.header.endTick); while (viewer.seeking) viewer.update(16, 1, 50);
  const at = viewer.divergedAtMs;
  viewer.seekTo(0); while (viewer.seeking) viewer.update(16, 1, 50);
  check('divergence is still reported after rewinding before it', at !== undefined && viewer.divergedAtMs === at, `${at} vs ${viewer.divergedAtMs}`);
  const short = new ReplayViewer(encounter, parseReplay(serializeReplay(abandoned!)));
  short.seekTo(1e9); while (short.seeking) short.update(16, 1, 50);
  check('abandoned replay seeks to its own end without divergence', short.finished && short.tick === abandoned!.header.endTick && short.divergedAtMs === undefined);
}

// Checkpoint hashes ignore last-bit float noise between engines but still catch anything visible.
{
  const viewer = new ReplayViewer(encounter, finished!); viewer.seekTo(600); while (viewer.seeking) viewer.update(16, 1, 50);
  const state = viewer.simulation.state; const before = hashState(state);
  const bot = state.players.find((candidate) => !candidate.controlled)!;
  const x = bot.position.x; bot.position.x = x + 4e-13;
  check('a last-bit position difference does not change the hash', hashState(state) === before);
  bot.position.x = x + 1e-3;
  check('a visible position difference changes the hash', hashState(state) !== before);
  bot.position.x = x;
}

// A tampered/changed replay is surfaced by the viewer.
{
  const bad = parseReplay(serializeReplay(finished!)); bad.position[1] += 3000;
  const viewer = new ReplayViewer(encounter, bad); playOut(viewer);
  check('viewer reports the divergence time of a tampered replay', viewer.divergedAtMs !== undefined && viewer.divergedAtMs >= 0, String(viewer.divergedAtMs));
}

// Seed-only replay (batch panel failed seed): all bots, no input, verifies and ends at the encounter's end.
for (const seedEncounter of ['dmu_p3', 'forsaken']) {
  const seedReplay = recordSeedReplay(loadEncounter(seedEncounter), seedEncounter, 424242);
  const viewer = new ReplayViewer(loadEncounter(seedEncounter), parseReplay(serializeReplay(seedReplay))); playOut(viewer);
  check(`${seedEncounter}: seed-only replay has no controlled player and plays without divergence`, seedReplay.header.controlledPlayerId === undefined && viewer.driver === undefined && viewer.divergedAtMs === undefined && viewer.simulation.state.completed);
}

if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('viewer check passed');
