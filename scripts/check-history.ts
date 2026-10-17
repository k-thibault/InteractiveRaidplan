// Check replay history retention and attempt recording.
// Run with: npx tsx scripts/check-history.ts
import { Simulation } from '../src/simulation/Simulation';
import { AttemptHistory } from '../src/replay/AttemptHistory';
import { recordSeedReplay, hashEncounter } from '../src/replay/playback';
import { serializeReplay } from '../src/replay/codec';
import { TICK_MS } from '../src/replay/format';
import { HISTORY_RETENTION_HOURS, MemoryStorage, ReplayHistoryStore, SESSION_ACTIVE_WINDOW_MS } from '../src/replay/ReplayStore';
import { loadEncounter, randomWalk } from './lib';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failures += 1; };
const HOUR = 3_600_000;

const encounter = loadEncounter('forsaken');
const replay = recordSeedReplay(encounter, 'forsaken', 77);

async function main(): Promise<void> {
  // Share storage across independent sessions.
  const storage = new MemoryStorage();
  let clock = 1_000_000_000_000;
  const open = (sessionId: string) => new ReplayHistoryStore(storage, { sessionId, now: () => clock });

  const first = open('s1');
  const saved = await first.save(replay);
  check('saved record carries a summary', saved.summary.encounterId === 'forsaken' && saved.summary.seed === 77 && saved.summary.completed && saved.summary.endTick === replay.header.endTick);
  clock += 1000; await first.save({ ...replay, header: { ...replay.header, seed: 78 } });
  clock += 1000; await first.save({ ...replay, header: { ...replay.header, seed: 79 } });
  const listed = await first.list();
  check('history lists newest first', listed.map((record) => record.summary.seed).join() === '79,78,77');
  const loaded = await first.load(saved.id);
  check('a stored replay loads back identical', loaded !== undefined && serializeReplay(loaded) === serializeReplay(replay));
  check('loading an unknown id gives nothing', (await first.load('nope')) === undefined);

  // Purge: only previous-session replays older than the retention limit go; the current session's stay however old.
  clock += 2 * HOUR; // s1 saved at t0..t0+2s; now t0+2h+2s
  const second = open('s2'); await second.heartbeat();
  check('nothing is purged when everything is recent', (await second.purge()) === 0 && (await second.list()).length === 3);
  clock += (HISTORY_RETENTION_HOURS - 1) * HOUR; // 25 h after s1's first save, s1 inactive for > 5 minutes
  await second.save({ ...replay, header: { ...replay.header, seed: 100 } }); // a fresh s2 replay
  const purged = await second.purge();
  check('previous-session replays older than the limit are purged', purged === 3 && (await second.list()).map((record) => record.summary.seed).join() === '100', `purged ${purged}`);

  // The current session keeps its own replays however old, until cleared.
  clock += 3 * HISTORY_RETENTION_HOURS * HOUR; await second.heartbeat();
  check('the current session never purges its own replays', (await second.purge()) === 0 && (await second.list()).length === 1);

  // A session that is still open elsewhere (recent heartbeat) is protected even when its replays are old.
  const third = open('s3'); await third.save({ ...replay, header: { ...replay.header, seed: 200 } });
  clock += 2 * HISTORY_RETENTION_HOURS * HOUR;
  await third.heartbeat();
  const fourth = open('s4'); await fourth.heartbeat();
  await fourth.purge(); // also clears s2's long-idle replay, which is not what this check is about
  check('replays of a session that is still active are not purged', (await fourth.list()).some((record) => record.summary.seed === 200));
  clock += SESSION_ACTIVE_WINDOW_MS + 1;
  check('once that session goes quiet its old replays are purged', (await fourth.purge()) >= 1 && !(await fourth.list()).some((record) => record.summary.seed === 200));

  // Boundary: exactly the retention age is kept, just over is purged.
  const fifth = open('s5'); await fifth.save({ ...replay, header: { ...replay.header, seed: 300 } });
  clock += HISTORY_RETENTION_HOURS * HOUR; const sixth = open('s6');
  check('a replay exactly at the retention age is kept', (await sixth.purge()) === 0);
  clock += 1 + SESSION_ACTIVE_WINDOW_MS;
  check('a replay just past the retention age is purged', (await sixth.purge()) === 1);

  // Remove and clear.
  const seventh = open('s7'); const a = await seventh.save(replay); await seventh.save(replay);
  await seventh.remove(a.id);
  check('remove deletes one replay', (await seventh.list()).length === 1);
  await seventh.clear();
  check('clear deletes them all', (await seventh.list()).length === 0);
  check('purge also forgets long-inactive sessions', Object.keys(await storage.sessionActivity()).length <= 2, JSON.stringify(Object.keys(await storage.sessionActivity())));

  // AttemptHistory hook: called once per ended attempt, never for an attempt that never ticked.
  const closed: number[] = [];
  const history = new AttemptHistory((ended) => closed.push(ended.header.endTick));
  const players = encounter.players; const hash = hashEncounter(encounter);
  const meta = (seed: number) => ({ encounterId: 'forsaken', encounterHash: hash, seed, outcomes: new Map<string, Record<string, unknown>>(), tickMs: TICK_MS });
  const attempt = (seed: number) => { const sim = new Simulation(encounter, { seed, controlledPlayerId: players[0].id, replayOutcomes: new Map() }); history.begin(sim, randomWalk(sim, players[0].id, seed), meta(seed)); sim.start(); return sim; };
  let sim = attempt(1); for (let i = 0; i < 50; i += 1) sim.tick(TICK_MS); history.abandon();
  check('onClose fires for an abandoned attempt with its end tick', closed.length === 1 && closed[0] === 50);
  sim = attempt(2); history.abandon();
  check('onClose does not fire for an attempt that never ticked', closed.length === 1);
  sim = attempt(3); while (!sim.state.completed) sim.tick(TICK_MS); history.settle(); history.settle(); history.abandon();
  check('onClose fires once for a completed attempt', closed.length === 2 && closed[1] === sim.tickCount);
}

await main();
if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('history check passed');
