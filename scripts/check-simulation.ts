// Guards core simulation rules with tiny synthetic encounters: timeline, statuses, damage, casts, areas, knocks, arena edges and bots.
// Run with: npx tsx scripts/check-simulation.ts
import type { Encounter } from '../src/encounters/Encounter';
import { Simulation } from '../src/simulation/Simulation';
import { stepControlledPlayer } from '../src/input/ControlledMovement';
import { deriveSeed } from '../src/dev/BatchRun';
import { shownWhileHidden } from '../src/entities/Enemy';
import { TICK_MS } from './lib';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) { failures += 1; if (detail !== undefined) console.error(`      ${String(detail)}`); } }

const player = (id: string, x: number, y: number, extra: object = {}) => ({ id, name: id.toUpperCase(), type: 'player', role: 'damage', mechanicalRoles: [], moveSpeed: 5, health: 100, alive: true, position: { x, y }, statuses: [], ...extra });
const statuses = [
  { id: 'buff', name: 'Buff', maxStacks: 3 },
  { id: 'single', name: 'Single' },
  { id: 'root', name: 'Root', control: 'root' },
  { id: 'stun', name: 'Stun', control: 'stun' },
  { id: 'anchor', name: 'Anchor', knockImmune: true },
  { id: 'fire-weak', name: 'Fire weak', damageTaken: [{ damageType: 'fire', multiplier: 2 }] },
];

function make(extra: Partial<Encounter> = {}, seed = 1, controlledPlayerId?: string): Simulation {
  const encounter = {
    version: 3, name: 'check', duration: 20000, statuses, casts: {},
    players: [player('a', -8, 6), player('b', 8, 6), player('c', 0, 6), player('d', -4, 6)],
    enemies: [{ id: 'boss', name: 'Boss', type: 'enemy', alive: true, position: { x: 0, y: -6 }, statuses: [] }],
    events: [], ...extra,
  } as unknown as Encounter;
  const simulation = new Simulation(encounter, { seed, controlledPlayerId, replayOutcomes: new Map() });
  simulation.start();
  return simulation;
}
/** Advance to a point in simulated time, in the same fixed steps the app uses. */
function until(simulation: Simulation, ms: number): void { while (simulation.state.time < ms - 1e-6 && !simulation.state.completed) simulation.tick(TICK_MS); }
const find = (simulation: Simulation, id: string) => simulation.state.players.find((candidate) => candidate.id === id)!;
const at = (id: string, time: number, event: object) => ({ id, at: time, ...event });
const everyone = { type: 'all' };
const only = (id: string) => ({ type: 'players', ids: [id] });
const hit = (id: string, time: number, amount: number, type = 'physical', fatal?: boolean) => at(id, time, { type: 'damage', target: everyone, damage: { amount, type, ...(fatal ? { fatal } : {}) } });

// Run lifecycle
{
  const simulation = make({ duration: 2000 });
  until(simulation, 1000);
  check('time advances only while running', simulation.state.time > 990 && simulation.state.running && !simulation.state.completed);
  simulation.pause(); const frozen = simulation.state.time; simulation.tick(TICK_MS); simulation.tick(TICK_MS);
  check('a paused simulation does not advance', simulation.state.time === frozen);
  simulation.start(); until(simulation, 5000);
  check('the run completes at the encounter duration and stops', simulation.state.completed && !simulation.state.running && simulation.state.time >= 2000 && simulation.state.time < 2000 + TICK_MS + 1);
  const ticks = simulation.tickCount; simulation.tick(TICK_MS);
  check('a completed run ignores further ticks', simulation.tickCount === ticks);
  const idle = make(); idle.pause(); const before = idle.state.time; idle.idleTick(TICK_MS);
  check('idle ticks before the start do not advance the run', idle.state.time === before && idle.tickCount === 0 && idle.isPreStart);
}

// Timeline: at, after + delay, ifMechanic
{
  const simulation = make({ events: [
    hit('first', 1000, 10),
    { id: 'second', after: 'first', delay: 500, type: 'damage', target: everyone, damage: { amount: 20, type: 'physical' } },
    { id: 'third', after: 'second', type: 'damage', target: everyone, damage: { amount: 5, type: 'physical' } },
  ] as never });
  until(simulation, 900); const h0 = find(simulation, 'a').health;
  until(simulation, 1100); const h1 = find(simulation, 'a').health;
  until(simulation, 1400); const h2 = find(simulation, 'a').health;
  until(simulation, 1600); const h3 = find(simulation, 'a').health;
  check('events run at their time, `after` + `delay` chain from the earlier event', h0 === 100 && h1 === 90 && h2 === 90 && h3 === 65, [h0, h1, h2, h3].join());
  const gated = make({ events: [
    at('set', 100, { type: 'set_mechanic', mechanic: 'x' }),
    at('skipped', 200, { type: 'damage', target: everyone, damage: { amount: 10, type: 'physical' }, ifMechanic: 'y' }),
    at('applied', 300, { type: 'damage', target: everyone, damage: { amount: 20, type: 'physical' }, ifMechanic: ['y', 'x'] }),
  ] as never });
  until(gated, 1000);
  check('ifMechanic only runs events for the current mechanic', find(gated, 'a').health === 80 && gated.state.currentMechanic === 'x');
}

// Statuses
{
  const simulation = make({ events: [
    at('buff-1', 100, { type: 'apply_status', target: only('a'), status: 'buff', duration: 1000 }),
    at('buff-2', 200, { type: 'apply_status', target: only('a'), status: 'buff', duration: 1000, stacks: 5 }),
    at('single-1', 100, { type: 'apply_status', target: only('b'), status: 'single', duration: 1000 }),
    at('single-2', 600, { type: 'apply_status', target: only('b'), status: 'single', duration: 1000 }),
    at('forever', 100, { type: 'apply_status', target: only('c'), status: 'single' }),
    at('strip', 500, { type: 'remove_status', target: only('d'), status: 'single' }),
    at('give-d', 100, { type: 'apply_status', target: only('d'), status: 'single', duration: 5000 }),
  ] as never });
  until(simulation, 300);
  const stacks = find(simulation, 'a').statuses.filter((status) => status.definitionId === 'buff').reduce((sum, status) => sum + status.stacks, 0);
  check('stacks add up but never past maxStacks', stacks === 3, stacks);
  until(simulation, 900); const refreshed = find(simulation, 'b').statuses.filter((status) => status.definitionId === 'single');
  check('re-applying a single-stack status leaves one instance', refreshed.length === 1, refreshed.length);
  until(simulation, 1300);
  check('a status expires after its duration', find(simulation, 'a').statuses.length === 0);
  until(simulation, 1500);
  check('re-applying refreshes the duration', find(simulation, 'b').statuses.length === 1);
  until(simulation, 1800);
  check('...and it then expires from the later application', find(simulation, 'b').statuses.length === 0);
  check('a status without a duration lasts', find(simulation, 'c').statuses.length === 1);
  check('remove_status takes a status off', find(simulation, 'd').statuses.length === 0);
}

// Damage, healing and deaths
{
  const simulation = make({ events: [
    at('weak', 100, { type: 'apply_status', target: only('a'), status: 'fire-weak', duration: 60000 }),
    hit('fire', 500, 30, 'fire'),
    at('heal', 1000, { type: 'heal', target: only('b'), amount: 15, full: false }),
    at('overheal', 1500, { type: 'heal', target: only('c'), amount: 500, full: false }),
    at('full', 2000, { type: 'heal', target: only('a'), full: true }),
    at('doomed', 3000, { type: 'damage', target: only('d'), damage: { amount: 1, type: 'physical', fatal: true } }),
    at('after-death', 3500, { type: 'heal', target: only('d'), full: true }),
  ] as never });
  until(simulation, 600);
  check('vulnerability scales matching damage', find(simulation, 'a').health === 40 && find(simulation, 'b').health === 70);
  until(simulation, 1200); check('heal adds the amount', find(simulation, 'b').health === 85);
  until(simulation, 1700); check('healing never exceeds max health', find(simulation, 'c').health === 100);
  until(simulation, 2200); check('full heal restores max health', find(simulation, 'a').health === 100);
  until(simulation, 3200);
  const dead = find(simulation, 'd');
  check('fatal damage kills and is recorded once', !dead.alive && dead.health === 0 && simulation.state.deaths.length === 1 && simulation.state.deaths[0].playerId === 'd' && simulation.state.deaths[0].fatal);
  until(simulation, 3800); check('healing does not raise the dead', !find(simulation, 'd').alive);
}

// Casts and areas
{
  const simulation = make({
    casts: { slam: { id: 'slam', name: 'Slam', castTime: 1000, visible: true, effects: [{ type: 'spawn_area', position: { x: -8, y: 6 }, shape: 'circle', radius: 2, mechanic: 'slam', element: 'physical', telegraphDuration: 500, duration: 100,
      resolution: [{ condition: { type: 'player_count', min: 1 }, effects: [{ type: 'damage', target: 'inside', damage: { amount: 40, type: 'physical' } }] }] }] } },
    events: [at('slam', 500, { type: 'start_cast', source: 'boss', cast: 'slam' })] as never,
  });
  until(simulation, 1000);
  check('a started cast is listed with its completion time', simulation.state.casts.length === 1 && simulation.state.casts[0].definitionId === 'slam' && Math.abs(simulation.state.casts[0].completesAt - 1500) < 1, JSON.stringify(simulation.state.casts));
  until(simulation, 1900);
  check('the cast has completed and its area is telegraphing without damage', simulation.state.casts.length === 0 && simulation.state.effects.length === 1 && find(simulation, 'a').health === 100);
  until(simulation, 2200);
  check('the area hits only the players inside it when it resolves', find(simulation, 'a').health === 60 && ['b', 'c', 'd'].every((id) => find(simulation, id).health === 100));
  until(simulation, 2600); check('the resolved area is cleaned up', simulation.state.effects.length === 0);
  const dodged = make({
    casts: { slam: { id: 'slam', name: 'Slam', castTime: 100, visible: true, effects: [{ type: 'spawn_area', position: { x: -8, y: 6 }, shape: 'circle', radius: 2, telegraphDuration: 500, duration: 100,
      resolution: [{ condition: { type: 'player_count', min: 1 }, effects: [{ type: 'damage', target: 'inside', damage: { amount: 40, type: 'physical' } }] }] }] } },
    events: [at('slam', 0, { type: 'start_cast', source: 'boss', cast: 'slam' })] as never,
  });
  until(dodged, 300); find(dodged, 'a').position.x = 8; find(dodged, 'a').position.y = -3;
  until(dodged, 1200);
  check('standing outside the area when it resolves avoids the hit', find(dodged, 'a').health === 100);
}

// Wipes end the run a few seconds after the last player dies
{
  const kill = (id: string, time: number, ids: string[]) => at(id, time, { type: 'damage', target: { type: 'players', ids }, damage: { amount: 1, type: 'physical', fatal: true } });
  const wiped = make({ events: [kill('all', 1000, ['a', 'b', 'c', 'd'])] as never });
  until(wiped, 3800);
  check('the run keeps going while the wipe plays out', wiped.state.running && !wiped.state.completed && !wiped.state.failed);
  until(wiped, 4200);
  check('the run ends as a failure once everyone has been dead for the delay', wiped.state.failed && wiped.state.completed && !wiped.state.running && wiped.state.time < 4000 + 2 * TICK_MS, wiped.state.time);
  check('the wipe is logged and further ticks are ignored', wiped.state.log.some((entry) => /failed/i.test(entry.message)) && (() => { const ticks = wiped.tickCount; wiped.tick(TICK_MS); return wiped.tickCount === ticks; })());

  const survivor = make({ events: [kill('three', 1000, ['a', 'b', 'c'])] as never });
  until(survivor, 9000);
  check('a survivor keeps the run going', survivor.state.running && !survivor.state.failed && !survivor.state.completed);
  const late = make({ duration: 2000, events: [kill('all', 1900, ['a', 'b', 'c', 'd'])] as never });
  until(late, 6000);
  check('reaching the end of the timeline first is not a failure', late.state.completed && !late.state.failed);
}

// Shotcalls
{
  const simulation = make({ events: [
    at('call', 100, { type: 'set_shotcall', text: 'Stack', duration: 500 }),
    at('sticky', 1000, { type: 'set_shotcall', text: 'Spread' }),
    at('clear', 2000, { type: 'clear_shotcall' }),
  ] as never });
  until(simulation, 300); check('a shotcall shows its text', simulation.state.shotcall?.text === 'Stack');
  until(simulation, 800); check('a timed shotcall expires', simulation.state.shotcall === undefined);
  until(simulation, 1500); check('an untimed shotcall stays until replaced', simulation.state.shotcall?.text === 'Spread');
  until(simulation, 2100); check('clear_shotcall removes it', simulation.state.shotcall === undefined);
}

// Knocks and control
{
  const simulation = make({ events: [
    at('anchor', 0, { type: 'apply_status', target: only('b'), status: 'anchor', duration: 60000 }),
    at('knock', 500, { type: 'knock', target: { type: 'players', ids: ['a', 'b'] }, distance: 6, duration: 500, direction: { type: 'linear', angle: 90 } }),
  ] as never });
  until(simulation, 600); check('a knock is in progress', find(simulation, 'a').knock !== undefined);
  until(simulation, 1200);
  check('a linear knock at 90 degrees moves a player east by its distance', Math.abs(find(simulation, 'a').position.x - -2) < 0.01 && Math.abs(find(simulation, 'a').position.y - 6) < 0.01 && find(simulation, 'a').knock === undefined, JSON.stringify(find(simulation, 'a').position));
  check('knockImmune ignores the knock', find(simulation, 'b').position.x === 8);

  const rooted = make({ events: [at('root', 0, { type: 'apply_status', target: only('a'), status: 'root', duration: 1000 }), at('stun', 0, { type: 'apply_status', target: only('b'), status: 'stun', duration: 1000 })] as never });
  until(rooted, 100);
  const a = find(rooted, 'a'); const b = find(rooted, 'b'); const startA = { ...a.position }; b.facing = 90;
  stepControlledPlayer(a, rooted.state.arena, { direction: { x: 1, y: 0 } }, 0.5); stepControlledPlayer(b, rooted.state.arena, { direction: { x: 0, y: 1 } }, 0.5);
  check('a root blocks movement but not turning', a.position.x === startA.x && a.facing === 90);
  check('a stun blocks movement and turning', b.position.y === 6 && b.facing === 90);
  until(rooted, 1500); const free = find(rooted, 'a'); const before = free.position.x;
  stepControlledPlayer(free, rooted.state.arena, { direction: { x: 1, y: 0 } }, 0.5);
  check('movement returns when the root expires', free.position.x > before);
}

// Arena edges
{
  const deadly = make({ arena: { shape: 'square', size: 20, edge: 'deadly' }, players: [player('a', 9, 0), player('b', 0, 0)] as never });
  until(deadly, 100); check('inside a deadly arena nobody dies', deadly.state.deaths.length === 0);
  find(deadly, 'a').position.x = 10.5; until(deadly, 300);
  check('crossing a deadly edge kills with the arena edge as the source', !find(deadly, 'a').alive && find(deadly, 'b').alive && deadly.state.deaths[0]?.source === 'the arena edge', JSON.stringify(deadly.state.deaths));
  const wall = make({ arena: { shape: 'square', size: 20, edge: 'wall' }, players: [player('a', 9, 0)] as never });
  find(wall, 'a').position.x = 10.5; until(wall, 300);
  check('a wall edge never kills', find(wall, 'a').alive && wall.state.deaths.length === 0);
}

// Bots
{
  const rules = { default: [{ when: { type: 'gameplay_role', role: 'damage' }, target: { type: 'fixed', position: { x: 3, y: 4 } } }] };
  const simulation = make({ positions: rules, events: [at('go', 0, { type: 'recalculate_positions', group: 'default' })] as never, players: [player('a', -8, 6)] as never });
  until(simulation, 5000);
  const bot = find(simulation, 'a');
  check('a bot walks to its assigned spot and stands on it', Math.hypot(bot.position.x - 3, bot.position.y - 4) < 0.2, JSON.stringify(bot.position));
  const slow = make({ positions: rules, events: [at('go', 0, { type: 'recalculate_positions', group: 'default' })] as never, players: [player('a', -8, 6)] as never });
  until(slow, 1000); const travelled = Math.hypot(find(slow, 'a').position.x + 8, find(slow, 'a').position.y - 6);
  check('a bot moves no faster than its move speed', travelled <= 5 * 1 + 0.1 && travelled > 3, travelled);
  const idle = make({ players: [player('a', -8, 6)] as never }); until(idle, 3000);
  check('a bot with no position rule stays put', find(idle, 'a').position.x === -8 && find(idle, 'a').position.y === 6);
  const left = make({ positions: rules, events: [at('go', 0, { type: 'recalculate_positions', group: 'default' }), at('release', 500, { type: 'release_positions', target: everyone })] as never, players: [player('a', -8, 6)] as never });
  until(left, 600); const mark = { ...find(left, 'a').position }; until(left, 3000);
  check('release_positions stops a bot where it is', Math.hypot(find(left, 'a').position.x - mark.x, find(left, 'a').position.y - mark.y) < 0.2);
}

// Seeds
{
  const draws = (seed: number) => { const simulation = make({ randomGroups: { pick: { mode: 'choice', values: ['a', 'b', 'c', 'd', 'e', 'f'] } } } as never, seed); return JSON.stringify(simulation.rolledChoices); };
  const outputs = new Set(Array.from({ length: 16 }, (_, index) => draws(deriveSeed(0, index))));
  check('the same seed repeats a random group roll', draws(5) === draws(5));
  check('different seeds roll differently', outputs.size > 1, [...outputs].join(' | '));
}

// Hiding enemies: only forced-visible enemies and ones chasing the controlled player stay drawn
{
  const follow = (target: string, time = 0) => at(`follow-${target}`, time, { type: 'start_follow', source: 'boss', target: { type: 'id', id: target }, distance: 2 });
  const encounter = (events: object[]): Partial<Encounter> => ({
    enemies: [
      { id: 'boss', name: 'Boss', type: 'enemy', alive: true, position: { x: 0, y: -6 }, statuses: [] },
      { id: 'shown', name: 'Shown', type: 'enemy', alive: true, position: { x: 4, y: -6 }, statuses: [], forceVisible: true },
      { id: 'plain', name: 'Plain', type: 'enemy', alive: true, position: { x: -4, y: -6 }, statuses: [] },
    ],
    enemyTemplates: { marker: { name: 'Marker', forceVisible: true } },
    casts: {
      hold: { id: 'hold', name: 'Hold', castTime: 1000, effects: [], suspendFollow: { movement: true } },
      turn: { id: 'turn', name: 'Turn', castTime: 1000, effects: [], suspendFollow: { facing: true } },
      reveal: { id: 'reveal', name: 'Reveal', castTime: 1000, effects: [], revealCaster: true },
    },
    events: [
      at('marker', 0, { type: 'spawn_enemy', enemyId: 'marker', enemy: 'marker', position: { x: 2, y: 2 } }),
      at('extra', 0, { type: 'spawn_enemy', enemyId: 'extra', position: { x: -2, y: 2 } }),
      ...events,
    ] as never,
  });
  const visible = (simulation: Simulation) => simulation.state.enemies.filter((enemy) => shownWhileHidden(enemy, simulation.state.casts)).map((enemy) => enemy.id).sort().join();

  let simulation = make(encounter([follow('a'), at('hold', 1000, { type: 'start_cast', source: 'boss', cast: 'hold' }), at('turn', 3000, { type: 'start_cast', source: 'boss', cast: 'turn' }), at('stop', 5000, { type: 'stop_follow', source: 'boss' })]), 1, 'a');
  until(simulation, 500);
  check('forceVisible entities and templates stay shown, as does an enemy following the controlled player', visible(simulation) === 'boss,marker,shown');
  until(simulation, 1500);
  check('a follow suspended by a held movement is hidden again', visible(simulation) === 'marker,shown');
  until(simulation, 2500);
  check('the enemy is shown again when the hold ends', visible(simulation) === 'boss,marker,shown');
  until(simulation, 3500);
  check('a follow with only facing held keeps chasing, so stays shown', visible(simulation) === 'boss,marker,shown');
  until(simulation, 5500);
  check('an enemy whose follow was stopped is hidden', visible(simulation) === 'marker,shown');

  simulation = make(encounter([at('reveal', 1000, { type: 'start_cast', source: 'plain', cast: 'reveal' })]), 1, 'a');
  until(simulation, 500); const before = visible(simulation); until(simulation, 1500); const during = visible(simulation); until(simulation, 2500);
  check('a caster is shown for the length of a revealing cast only', before === 'marker,shown' && during === 'marker,plain,shown' && visible(simulation) === before);

  simulation = make(encounter([follow('b')]), 1, 'a'); until(simulation, 500);
  check('following another player does not show the enemy', visible(simulation) === 'marker,shown');
  simulation = make(encounter([follow('a')])); until(simulation, 500);
  check('following a bot while nobody is controlled does not show the enemy', visible(simulation) === 'marker,shown');
  simulation = make(encounter([at('fixed', 0, { type: 'start_follow', source: 'boss', position: { x: 5, y: 5 }, distance: 1 })]), 1, 'a'); until(simulation, 500);
  check('chasing a fixed point does not show the enemy', visible(simulation) === 'marker,shown');
}

console.log(failures === 0 ? '\nsimulation check passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
