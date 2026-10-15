// Run with: npx tsx scripts/tether-check.ts
import { Simulation } from '../src/simulation/Simulation';
import { selectPlayers } from '../src/mechanics/Selector';
import { Random } from '../src/simulation/Random';
import type { Encounter } from '../src/encounters/Encounter';

let failures = 0;
function check(name: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures += 1; }

const player = (id: string, x: number, y: number) => ({ id, name: id.toUpperCase(), type: 'player', role: 'damage', mechanicalRoles: [], moveSpeed: 5, health: 100, alive: true, position: { x, y }, statuses: [] });

function make(extra: Partial<Encounter>): Simulation {
  const encounter = {
    version: 3, name: 'check', duration: 60000, statuses: [], casts: {},
    players: [player('a', 0, 6), player('b', 6, 6), player('c', 3, -1), player('d', -6, 6)],
    enemies: [{ id: 'boss', name: 'Boss', type: 'enemy', alive: true, position: { x: 0, y: -6 }, statuses: [] }],
    events: [], ...extra,
  } as unknown as Encounter;
  const sim = new Simulation(encounter, { seed: 1 });
  sim.start();
  return sim;
}
const tick = (sim: Simulation, n = 2) => { for (let i = 0; i < n; i += 1) sim.tick(16); };
const move = (sim: Simulation, id: string, x: number, y: number) => { const p = sim.state.players.find((q) => q.id === id)!; p.position.x = x; p.position.y = y; };
const holder = (sim: Simulation, tag: string) => sim.state.tethers.find((t) => t.tag === tag)?.targetId;
const spawn = (id: string, ids: string[], extra: object = {}) => ({ id, at: 0, type: 'spawn_tether', target: { type: 'players', ids }, ...extra });

// 1. one tether per pair, even with a different definition
{
  const sim = make({ events: [spawn('s1', ['a'], { label: 'x' }), spawn('s2', ['a'], { label: 'y' })] as never });
  tick(sim);
  check('duplicate pair is refused', sim.state.tethers.length === 1 && sim.state.tethers[0].tag === 'x');
}

// 2. pass-on, ineligible interposer, and the A/B/C chain from the spec
{
  const sim = make({ events: [spawn('s1', ['a'], { label: 'ta', passable: true }), spawn('s2', ['b'], { label: 'tb', passable: true })] as never });
  tick(sim);
  check('no pass without a player on the line', holder(sim, 'ta') === 'a' && holder(sim, 'tb') === 'b');
  move(sim, 'a', 3, 0); // A stands on the boss->B line while holding its own tether
  tick(sim);
  check('tethered player stepping in front of another cannot take it', holder(sim, 'tb') === 'b' && holder(sim, 'ta') === 'a');
  move(sim, 'c', 0, 0); move(sim, 'a', 0, 6); // C steps onto boss->A
  tick(sim);
  check('third player takes the tether', holder(sim, 'ta') === 'c');
  move(sim, 'a', 3, 0); // A is free now and steps onto boss->B
  tick(sim);
  check('former holder can then take another tether', holder(sim, 'tb') === 'a' && holder(sim, 'ta') === 'c');
}

// 3. beyond the ends and off the line do not count; non-passable never moves
{
  const sim = make({ events: [spawn('s1', ['a'], { label: 'ta', passable: true }), spawn('s2', ['b'], { label: 'tb' })] as never });
  move(sim, 'c', 0, -8); tick(sim);
  check('behind the source does not pass', holder(sim, 'ta') === 'a');
  move(sim, 'c', 1.2, 0); tick(sim);
  check('off the line does not pass', holder(sim, 'ta') === 'a');
  move(sim, 'c', 0.3, 0); tick(sim);
  check('touching the line passes', holder(sim, 'ta') === 'c');
  move(sim, 'd', 3, 0); tick(sim);
  check('non-passable tether stays put', holder(sim, 'tb') === 'b');
}

// 4. break conditions, grace, baseline reset on pass, hook effects follow the holder
{
  const hit = [{ type: 'damage', target: 'tethered', damage: { amount: 30, type: 'physical' } }];
  const sim = make({
    tethers: { long: { name: 'Long', breakWhen: [{ type: 'too_long', length: 15 }], onBreak: hit },
      stretch: { name: 'Stretch', passable: true, breakWhen: [{ type: 'stretched', amount: 4 }], onBreak: hit },
      short: { name: 'Short', breakWhen: [{ type: 'too_short', length: 4 }], graceDuration: 1000, onBreak: hit } } as never,
    events: [spawn('s1', ['a'], { tether: 'long' }), spawn('s2', ['b'], { tether: 'stretch' }), spawn('s3', ['d'], { tether: 'short' })] as never });
  tick(sim);
  const hp = (id: string) => sim.state.players.find((p) => p.id === id)!.health;
  move(sim, 'a', 0, 12); tick(sim);
  check('too_long breaks and hits the holder', hp('a') === 70 && !sim.state.tethers.some((t) => t.tag === 'long'));
  move(sim, 'd', 0, -3); tick(sim);
  check('too_short is held off by the grace period', sim.state.tethers.some((t) => t.tag === 'short'));
  tick(sim, 70);
  check('too_short breaks after the grace period', hp('d') === 70);
  // stretch: B starts 15.2 from the boss; moving B 3 further is fine, 4 breaks
  move(sim, 'b', 6, 8.5); tick(sim);
  check('stretched not yet reached', sim.state.tethers.some((t) => t.tag === 'stretch'));
  move(sim, 'c', 3, 0); move(sim, 'b', 6, 6); tick(sim); // C intercepts: baseline resets to C's distance
  check('pass moved the tether', holder(sim, 'stretch') === 'c');
  move(sim, 'c', 3, 3.5); tick(sim);
  check('baseline reset on pass: small stretch from the new holder is fine', sim.state.tethers.some((t) => t.tag === 'stretch'));
  move(sim, 'c', 3, 9); tick(sim);
  check('stretched breaks and hooks hit the current holder', hp('c') === 70 && hp('b') === 100);
}

// 5. selector, expiry, removal, orphaning
{
  const sim = make({ tethers: { t: { duration: 500, onExpire: [{ type: 'damage', target: 'tethered', damage: { amount: 10, type: 'physical' } }] } } as never,
    events: [spawn('s1', ['a'], { tether: 't', passable: true }), { id: 's2', at: 0, type: 'spawn_tether', target: { type: 'players', ids: ['b'] }, label: 'keep' }] as never });
  tick(sim);
  const names = () => selectPlayers({ type: 'tethered', tether: 't' }, sim.state, new Random(1)).map((p) => p.id);
  check('tethered selector finds the holder', names().join() === 'a');
  move(sim, 'c', 0, 0); tick(sim);
  check('tethered selector follows a pass', names().join() === 'c');
  tick(sim, 40);
  check('expiry removes the tether and runs onExpire on the holder', !sim.state.tethers.some((t) => t.tag === 't') && sim.state.players.find((p) => p.id === 'c')!.health === 90);
  sim.state.players.find((p) => p.id === 'b')!.alive = false; tick(sim);
  check('tether to a dead player just ends', sim.state.tethers.length === 0);
}

// 6. cast facing follows the tether, including across a pass
{
  const sim = make({ casts: { hit: { id: 'hit', name: 'Hit', castTime: 1000, visible: true, facing: { type: 'tether', tether: 'ta' }, effects: [] } } as never,
    events: [spawn('s1', ['a'], { label: 'ta', passable: true }), { id: 'c1', at: 100, type: 'start_cast', source: 'boss', cast: 'hit' }] as never });
  tick(sim, 10);
  const cast = () => sim.state.casts[0];
  check('cast locks onto the tether target', cast()?.targetId === 'a' && cast().tetherId !== undefined);
  move(sim, 'c', 0, 0); tick(sim);
  check('a pass redirects the cast', cast().targetId === 'c' && Math.abs(Math.cos(cast().direction!)) < 1e-6);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
