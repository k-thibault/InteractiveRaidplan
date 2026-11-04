// Guards core simulation rules with tiny synthetic encounters: timeline, statuses, damage, casts, areas, knocks, arena edges and bots.
// Run with: npx tsx scripts/check-simulation.ts
import type { Encounter } from '../src/encounters/Encounter';
import { Simulation } from '../src/simulation/Simulation';
import { stepControlledPlayer } from '../src/input/ControlledMovement';
import { deriveSeed } from '../src/dev/BatchRun';
import { shownWhileHidden } from '../src/entities/Enemy';
import { displayedGraphic } from '../src/mechanics/Cast';
import { collectEntityGraphics, validateBatches, validateDelayedEffects, validateStatuses } from '../src/encounters/EncounterLoader';
import { hashState } from '../src/replay/hash';
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
  { id: 'ward', name: 'Ward', damageImmunity: { mode: 'invulnerable' } },
  { id: 'ward-once', name: 'Ward once', damageImmunity: { mode: 'invulnerable', charges: 1 } },
  { id: 'grit', name: 'Grit', damageImmunity: { mode: 'undying' } },
  { id: 'grit-once', name: 'Grit once', damageImmunity: { mode: 'undying', charges: 1 } },
  { id: 'aura', name: 'Aura', proximity: { radius: 3, effects: [{ type: 'damage', target: 'proximity_target', damage: { amount: 10, type: 'magical' } }] } },
  { id: 'aura-fade', name: 'Aura fade', proximity: { radius: 3, fadeOnTrigger: true, effects: [{ type: 'damage', target: 'proximity_target', damage: { amount: 10, type: 'magical' } }] } },
  { id: 'trap', name: 'Trap', hidden: true, proximity: { radius: 3, effects: [{ type: 'damage', target: 'proximity_target', damage: { amount: 0, type: 'dark', fatal: true, bypassImmunity: true } }] } },
  { id: 'mark', name: 'Mark', onRemove: [{ type: 'add_to_batch', batch: 'marks' }] },
  { id: 'pulse', name: 'Pulse', proximity: { radius: 3, interval: 1000, effects: [{ type: 'damage', target: 'proximity_target', damage: { amount: 5, type: 'magical' } }] } },
];

function make(extra: Partial<Encounter> = {}, seed = 1, controlledPlayerId?: string, replayOutcomes = new Map<string, Record<string, unknown>>()): Simulation {
  const encounter = {
    version: 3, name: 'check', duration: 20000, statuses, casts: {},
    players: [player('a', -8, 6), player('b', 8, 6), player('c', 0, 6), player('d', -4, 6)],
    enemies: [{ id: 'boss', name: 'Boss', type: 'enemy', alive: true, position: { x: 0, y: -6 }, statuses: [] }],
    events: [], ...extra,
  } as unknown as Encounter;
  const simulation = new Simulation(encounter, { seed, controlledPlayerId, replayOutcomes });
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

// Delayed effects
{
  const simulation = make({
    sequences: { damage: { values: [10, 20], start: 0, step: 1 } },
    casts: { timer: { id: 'timer', name: 'Timer', castTime: 0, effects: [{ type: 'delayed_effects', delay: 100, effects: [
      { type: 'delayed_effects', delay: 100, effects: [{ type: 'damage', target: only('a'), damage: { amount: '$damage', type: 'physical' } }] },
      { type: 'damage', target: only('b'), damage: { amount: '$damage', type: 'physical' } },
    ] }] } } as never,
    events: [at('start', 0, { type: 'start_cast', source: 'boss', cast: 'timer' })] as never,
  });
  until(simulation, 300);
  check('nested delayed effects resolve their children when they run', find(simulation, 'a').health === 80 && find(simulation, 'b').health === 90);
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

// Damage immunity
{
  const dmg = (id: string, time: number, target: string, amount: number, extra: object = {}) => at(id, time, { type: 'damage', target: only(target), damage: { amount, type: 'physical', ...extra } });
  const apply = (id: string, status: string, target: string) => at(`apply-${id}`, 0, { type: 'apply_status', target: only(target), status });
  const simulation = make({ events: [
    apply('a', 'ward', 'a'), dmg('a-small', 100, 'a', 30), dmg('a-big', 200, 'a', 500), dmg('a-fatal', 300, 'a', 1, { fatal: true }), dmg('a-bypass', 450, 'a', 1, { fatal: true, bypassImmunity: true }),
    apply('b', 'ward-once', 'b'), dmg('b-small', 100, 'b', 30), dmg('b-big', 200, 'b', 500), dmg('b-second', 400, 'b', 500),
    apply('c', 'grit', 'c'), dmg('c-small', 100, 'c', 30), dmg('c-big', 200, 'c', 500), dmg('c-fatal', 300, 'c', 1, { fatal: true }), dmg('c-bypass', 400, 'c', 1, { fatal: true, bypassImmunity: true }),
    apply('d', 'grit-once', 'd'), dmg('d-big', 200, 'd', 500), dmg('d-second', 400, 'd', 500),
  ] as never });
  until(simulation, 150);
  check('undying takes ordinary damage normally', find(simulation, 'c').health === 70 && find(simulation, 'b').health === 100);
  until(simulation, 350);
  check('invulnerable takes no damage from ordinary, lethal or fatal hits', find(simulation, 'a').health === 100 && find(simulation, 'a').alive && simulation.state.deaths.every((death) => death.playerId !== 'a'));
  check('an invulnerable status without charges stays', find(simulation, 'a').statuses.length === 1);
  check('charges are spent only by lethal hits, and the status fades with the last one', find(simulation, 'b').health === 100 && find(simulation, 'b').statuses.length === 0);
  check('undying turns lethal and fatal hits into 1 health', find(simulation, 'c').alive && find(simulation, 'c').health === 1);
  check('undying with a charge fades after the first lethal hit', find(simulation, 'd').health === 1 && find(simulation, 'd').statuses.length === 0);
  until(simulation, 500);
  check('a spent shield no longer protects', !find(simulation, 'b').alive && !find(simulation, 'd').alive);
  check('bypassImmunity kills through undying', !find(simulation, 'c').alive && simulation.state.deaths.find((death) => death.playerId === 'c')?.fatal === true);
  check('bypassImmunity kills through invulnerability', !find(simulation, 'a').alive && find(simulation, 'a').statuses.length === 0);

  const mixed = make({ events: [apply('c', 'grit', 'c'), at('ward', 0, { type: 'apply_status', target: only('c'), status: 'ward' }), dmg('hit', 100, 'c', 40)] as never });
  until(mixed, 200);
  check('invulnerable wins over undying', find(mixed, 'c').health === 100);
  const edge = make({ arena: { shape: 'square', size: 20, edge: 'deadly' }, players: [player('a', 9, 0, { statuses: [{ definitionId: 'ward', appliedAt: 0, stacks: 1 }] }), player('b', 0, 0)] as never });
  until(edge, 100); find(edge, 'a').position.x = 12; until(edge, 300);
  check('a deadly arena edge kills through invulnerability', !find(edge, 'a').alive);
}

// Batch queue
{
  const addAll = at('add', 100, { type: 'for_each_group', group: 'everyone', effects: [{ type: 'add_to_batch', batch: 'b' }] });
  const batches = (extra: object) => ({ b: { window: 500, effects: [{ type: 'damage', target: only('a'), damage: { amount: '$batchCount', type: 'physical' } }], ...extra } });
  const run = (extra: object, times: number[]) => {
    const simulation = make({ batches: batches(extra) as never, events: [at('group', 0, { type: 'select_group', name: 'everyone', selector: everyone }), addAll] as never });
    return times.map((time) => { until(simulation, time); return find(simulation, 'a').health; });
  };
  check('a batch without maxCount takes every call', run({}, [500, 700]).join() === '100,96');
  check('maxCount carries extra calls into a batch queued behind the first', run({ maxCount: 2 }, [500, 700, 1100, 1300]).join() === '100,98,98,96');
  check('overflow immediate starts carried batches right away', run({ maxCount: 2, overflow: 'immediate' }, [500, 700]).join() === '100,96');
  check('maxCount 3 splits four calls into 3 and 1', run({ maxCount: 3 }, [700, 1300]).join() === '97,96');
  const later = make({ batches: batches({ maxCount: 2 }) as never, events: [at('group', 0, { type: 'select_group', name: 'everyone', selector: everyone }), addAll, { ...addAll, id: 'again', at: 300 }] as never });
  until(later, 1700);
  check('a later round of calls queues behind the batches already waiting', find(later, 'a').health === 94, find(later, 'a').health);
  until(later, 2300);
  check('every queued batch eventually resolves', find(later, 'a').health === 92, find(later, 'a').health);

  const entityStatus = (replayOutcomes: Map<string, Record<string, unknown>>, seed: number) => {
    const sim = make({
      enemies: [
        { id: 'boss', name: 'Boss', type: 'enemy', alive: true, position: { x: 0, y: -6 }, statuses: [] },
        { id: 'orb', name: 'Orb', type: 'enemy', alive: true, position: { x: 4, y: 6 }, statuses: [] },
      ] as never,
      casts: { arm: { id: 'arm', name: 'Arm', castTime: 0, effects: [{ type: 'apply_status', targetEntity: 'orb', statusChoices: ['ward', 'grit'], replayId: 'entity-status' }] } } as never,
      events: [at('arm', 0, { type: 'start_cast', source: 'boss', cast: 'arm' })] as never,
    }, seed, undefined, replayOutcomes);
    until(sim, 100);
    return sim.state.enemies.find((candidate) => candidate.id === 'orb')!.statuses[0]?.definitionId;
  };
  const recordedOutcomes = new Map<string, Record<string, unknown>>();
  const firstStatus = entityStatus(recordedOutcomes, 11);
  check('entity-target status choices are recorded for replay', typeof firstStatus === 'string' && recordedOutcomes.get('entity-status#0')?.status === firstStatus);
  const replayedStatus = entityStatus(new Map([...recordedOutcomes].map(([key, value]) => [key, structuredClone(value)])), 42);
  check('entity-target status choices replay across seeds', replayedStatus === firstStatus);
}

// Caster graphic
{
  const casts = {
    pose: { id: 'pose', name: 'Pose', castTime: 1000, visible: true, effects: [], casterGraphic: { image: 'pose-left' } },
    pose2: { id: 'pose2', name: 'Pose 2', castTime: 1500, visible: true, effects: [], casterGraphic: { image: 'pose-right', radius: 3 } },
    plain: { id: 'plain', name: 'Plain', castTime: 1000, visible: true, effects: [] },
  };
  const simulation = make({ casts: casts as never, enemies: [{ id: 'boss', name: 'Boss', type: 'enemy', alive: true, position: { x: 0, y: -6 }, statuses: [], graphic: { image: 'idle', radius: 2, rotate: true } }] as never, events: [
    at('p1', 100, { type: 'start_cast', source: 'boss', cast: 'pose' }), at('p2', 500, { type: 'start_cast', source: 'boss', cast: 'pose2' }), at('p3', 3000, { type: 'start_cast', source: 'boss', cast: 'plain' }),
  ] as never });
  const boss = () => simulation.state.enemies[0];
  const shown = () => displayedGraphic(boss(), simulation.state.casts);
  check('without a cast the base graphic is drawn', shown()?.image === 'idle');
  until(simulation, 300); check('a cast replaces the caster graphic and keeps the other fields', shown()?.image === 'pose-left' && shown()?.radius === 2 && shown()?.rotate === true);
  until(simulation, 700); check('the newest cast wins while casts overlap', shown()?.image === 'pose-right' && shown()?.radius === 3);
  until(simulation, 1200); check('the graphic falls back to the older cast when the newer one is still running', shown()?.image === 'pose-right');
  until(simulation, 2200); check('the base graphic returns when the casts end', shown()?.image === 'idle' && simulation.state.casts.length === 0);
  until(simulation, 3200); check('a cast without casterGraphic leaves the graphic alone', shown()?.image === 'idle');
  check('the entity itself is never modified', boss().graphic?.image === 'idle');
  const imageKeys = collectEntityGraphics([casts]);
  check('caster graphics are collected for preloading', imageKeys.has('pose-left') && imageKeys.has('pose-right') && imageKeys.size === 2);
}

// Proximity statuses
{
  const give = (status: string, target = 'c', time = 0) => at(`give-${status}-${target}`, time, { type: 'apply_status', target: only(target), status });
  const hp = (simulation: Simulation, id: string) => find(simulation, id).health;
  const move = (simulation: Simulation, id: string, x: number, y = 6) => { find(simulation, id).position.x = x; find(simulation, id).position.y = y; };

  let simulation = make({ events: [give('aura')] as never });
  until(simulation, 200);
  check('nobody in range means no effect', ['a', 'b', 'd'].every((id) => hp(simulation, id) === 100) && hp(simulation, 'c') === 100);
  move(simulation, 'b', 2); until(simulation, 300);
  check('a player entering range is hit, and not the holder', hp(simulation, 'b') === 90 && hp(simulation, 'c') === 100);
  until(simulation, 1300);
  check('staying in range does not hit again', hp(simulation, 'b') === 90);
  move(simulation, 'b', 8); until(simulation, 1400); move(simulation, 'b', 2); until(simulation, 1500);
  check('leaving and re-entering hits again while the status is active', hp(simulation, 'b') === 80);
  move(simulation, 'd', -2); until(simulation, 1600);
  check('other players entering are hit too and the status stays', hp(simulation, 'd') === 90 && find(simulation, 'c').statuses.length === 1);

  simulation = make({ players: [player('a', -8, 6), player('b', 1, 6), player('c', 0, 6), player('d', -4, 6)] as never, events: [give('aura')] as never });
  until(simulation, 200);
  check('a player already in range when the status lands is hit on the next tick', hp(simulation, 'b') === 90);

  simulation = make({ events: [give('aura-fade')] as never });
  until(simulation, 200); move(simulation, 'a', 2.5); move(simulation, 'b', 1); move(simulation, 'd', -2); until(simulation, 300);
  check('fadeOnTrigger hits only the nearest entrant', hp(simulation, 'b') === 90 && hp(simulation, 'a') === 100 && hp(simulation, 'd') === 100);
  check('fadeOnTrigger removes the status when it triggers', find(simulation, 'c').statuses.length === 0);
  move(simulation, 'a', 8); until(simulation, 400); move(simulation, 'a', 1); until(simulation, 500);
  check('a faded status no longer triggers', hp(simulation, 'a') === 100);

  simulation = make({ events: [give('pulse')] as never });
  until(simulation, 100); move(simulation, 'b', 2); until(simulation, 200);
  check('a repeating status hits on entry', hp(simulation, 'b') === 95);
  until(simulation, 900); check('and not before the interval has passed', hp(simulation, 'b') === 95);
  until(simulation, 1300); check('and again once it has', hp(simulation, 'b') === 90);
  move(simulation, 'b', 8); until(simulation, 1400); move(simulation, 'b', 2); until(simulation, 1600);
  check('leaving and re-entering does not shorten the interval', hp(simulation, 'b') === 90);
  until(simulation, 2400); check('a returning player is hit once the interval since the last hit has passed', hp(simulation, 'b') === 85);
  find(simulation, 'b').alive = false; until(simulation, 3600);
  check('dead players are not hit', hp(simulation, 'b') === 85);

  simulation = make({ events: [give('aura'), at('ward', 0, { type: 'apply_status', target: only('b'), status: 'ward' })] as never });
  until(simulation, 100); move(simulation, 'b', 2); until(simulation, 300);
  check('proximity damage respects immunity', hp(simulation, 'b') === 100);
}

// Statuses on enemies and batch sources
{
  const orb = { id: 'orb', name: 'Orb', type: 'enemy', alive: true, position: { x: 4, y: 6 }, statuses: [] };
  const simulation = make({ enemies: [{ id: 'boss', name: 'Boss', type: 'enemy', alive: true, position: { x: 0, y: -6 }, statuses: [] }, orb] as never, players: [player('a', -8, 6, { statuses: [{ definitionId: 'ward', appliedAt: 0, stacks: 1 }] }), player('b', 8, 6), player('c', 0, 6), player('d', -4, 6)] as never, events: [
    at('arm', 100, { type: 'apply_status', targetEntity: 'orb', status: 'trap', duration: 1000 }),
  ] as never });
  const enemy = () => simulation.state.enemies.find((candidate) => candidate.id === 'orb')!;
  until(simulation, 200);
  check('a status can be applied to an enemy', enemy().statuses.length === 1 && enemy().statuses[0].definitionId === 'trap');
  check('players outside the radius are left alone', simulation.state.players.every((candidate) => candidate.alive));
  find(simulation, 'a').position.x = 6; find(simulation, 'a').position.y = 6; until(simulation, 300);
  check('an enemy proximity status kills a player entering range, bypassing immunity', !find(simulation, 'a').alive && simulation.state.deaths[0]?.source === 'Trap');
  until(simulation, 1300);
  check('statuses on enemies expire', enemy().statuses.length === 0);
  find(simulation, 'c').position.x = 5; until(simulation, 1500);
  check('an expired status no longer triggers', find(simulation, 'c').alive);

  const replayHash = (proximity: { inRange: string[]; lastHit: Record<string, number> }) => {
    const sim = make();
    find(sim, 'a').statuses.push({ definitionId: 'aura', appliedAt: 0, stacks: 1, proximity });
    return hashState(sim.state);
  };
  check('replay hashes include proximity range state', replayHash({ inRange: [], lastHit: {} }) !== replayHash({ inRange: ['b'], lastHit: {} }));
  check('replay hashes include proximity cooldown state', replayHash({ inRange: [], lastHit: {} }) !== replayHash({ inRange: [], lastHit: { b: 100 } }));

  const queued = make({
    batches: { marks: { window: 500, maxCount: 1, effects: [{ type: 'damage', target: { type: 'players', ids: ['$batchSources[0]'] }, damage: { amount: 10, type: 'earth' } }] } } as never,
    events: [at('b', 100, { type: 'apply_status', target: only('b'), status: 'mark', duration: 100 }), at('c', 100, { type: 'apply_status', target: only('c'), status: 'mark', duration: 100 })] as never,
  });
  until(queued, 400);
  check('a batch call remembers who made it', find(queued, 'b').health === 100 && find(queued, 'c').health === 100);
  until(queued, 800); check('the first queued batch resolves for its own source', find(queued, 'b').health === 90 && find(queued, 'c').health === 100);
  until(queued, 1400); check('the next batch resolves for the next source', find(queued, 'c').health === 90 && find(queued, 'b').health === 90);
}

// Encounter validation
{
  const throws = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
  const withStatus = (status: object) => ({ statuses: [status], batches: {} }) as unknown as Encounter;
  const withBatch = (batch: object) => ({ statuses: [], batches: { b: batch } }) as unknown as Encounter;
  const withEffects = (effects: object[]) => ({ statuses: [], batches: {}, casts: { test: { effects } } }) as unknown as Encounter;
  const effects = [{ type: 'heal', target: 'proximity_target', full: true }];
  check('valid immunity, proximity and batch settings pass', !throws(() => { validateStatuses(withStatus({ id: 's', damageImmunity: { mode: 'undying', charges: 2 }, proximity: { radius: 4, interval: 500, effects } })); validateBatches(withBatch({ window: 0, maxCount: 3, overflow: 'immediate', effects: [] })); }));
  check('bad immunity settings are rejected', throws(() => validateStatuses(withStatus({ id: 's', damageImmunity: { mode: 'shield' } }))) && throws(() => validateStatuses(withStatus({ id: 's', damageImmunity: { mode: 'undying', charges: 0 } }))));
  check('bad proximity settings are rejected', throws(() => validateStatuses(withStatus({ id: 's', proximity: { radius: 0, effects } }))) && throws(() => validateStatuses(withStatus({ id: 's', proximity: { radius: 2, effects: [] } }))) && throws(() => validateStatuses(withStatus({ id: 's', proximity: { radius: 2, interval: 0, effects } }))) && throws(() => validateStatuses(withStatus({ id: 's', proximity: { radius: 2, interval: 500, fadeOnTrigger: true, effects } }))));
  check('bad batch settings are rejected', throws(() => validateBatches(withBatch({ maxCount: 0, effects: [] }))) && throws(() => validateBatches(withBatch({ maxCount: 1.5, effects: [] }))) && throws(() => validateBatches(withBatch({ overflow: 'later', effects: [] }))) && throws(() => validateBatches(withBatch({ window: -1, effects: [] }))));
  check('delayed-effect delays must be non-negative finite numbers', !throws(() => validateDelayedEffects(withEffects([{ type: 'delayed_effects', delay: 0, effects: [] }]))) && throws(() => validateDelayedEffects(withEffects([{ type: 'delayed_effects', delay: -1, effects: [] }]))) && throws(() => validateDelayedEffects(withEffects([{ type: 'delayed_effects', delay: Number.POSITIVE_INFINITY, effects: [] }]))));
}

console.log(failures === 0 ? '\nsimulation check passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
