// Guards small engine pieces: random numbers, scheduling, damage, streaks, formatting and replay run options.
// Run with: npx tsx scripts/check-core.ts
import { Random } from '../src/simulation/Random';
import { Scheduler } from '../src/simulation/Scheduler';
import { DamageResolver } from '../src/mechanics/DamageResolver';
import { StreakTracker } from '../src/streak/StreakTracker';
import { STREAK_TYPES, type RunFlags } from '../src/streak/StreakTypes';
import { formatClock, formatStatusName, statusDisplayName } from '../src/util/format';
import { DEFAULT_VIEW_OPTIONS, ViewOptionsHold } from '../src/ui/ViewOptions';
import type { Player } from '../src/entities/Player';
import type { StatusDefinition } from '../src/entities/Status';

let failures = 0;
function check(name: string, ok: boolean): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures += 1; }

// Random: every replay and batch seed relies on this exact stream
{
  const draw = (seed: number, count = 20) => { const random = new Random(seed); return Array.from({ length: count }, () => random.next()); };
  check('same seed gives the same stream', JSON.stringify(draw(7)) === JSON.stringify(draw(7)));
  check('different seeds differ', JSON.stringify(draw(7)) !== JSON.stringify(draw(8)));
  check('values stay in [0, 1)', draw(123, 5000).every((value) => value >= 0 && value < 1));
  check('seed is treated as a 32-bit integer', JSON.stringify(draw(2 ** 32 + 5)) === JSON.stringify(draw(5)) && JSON.stringify(draw(-1)) === JSON.stringify(draw(0xffffffff)));
  const random = new Random(99); const seen = new Set<number>();
  for (let index = 0; index < 2000; index += 1) seen.add(random.integer(3, 6));
  check('integer is inclusive on both ends and nothing else', [...seen].sort().join() === '3,4,5,6');
  const shuffled = new Random(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  const input = [1, 2, 3]; new Random(5).shuffle(input);
  check('shuffle is a permutation and leaves its input alone', shuffled.slice().sort().join() === '1,2,3,4,5,6,7,8' && input.join() === '1,2,3');
  check('shuffle is deterministic per seed', JSON.stringify(new Random(5).shuffle([1, 2, 3, 4, 5, 6, 7, 8])) === JSON.stringify(shuffled));
  const rough = new Random(2024); let below = 0;
  for (let index = 0; index < 20000; index += 1) if (rough.next() < 0.5) below += 1;
  check('stream is roughly uniform', below > 9500 && below < 10500);
}

// Scheduler
{
  const scheduler = new Scheduler(); const fired: string[] = [];
  scheduler.schedule('late', 300, () => fired.push('late')); scheduler.schedule('early', 100, () => fired.push('early')); scheduler.schedule('mid', 200, () => fired.push('mid'));
  scheduler.update(50);
  check('nothing fires before its time', fired.length === 0);
  scheduler.update(200);
  check('events fire in time order, once', fired.join() === 'early,mid');
  scheduler.update(200);
  check('an event is not repeated', fired.join() === 'early,mid');
  scheduler.update(1000);
  check('a late update catches everything up', fired.join() === 'early,mid,late');
  scheduler.schedule('a', 10, () => fired.push('a')); scheduler.clear(); scheduler.update(100);
  check('clear drops pending events', !fired.includes('a'));
  const chain: string[] = []; const nested = new Scheduler();
  nested.schedule('first', 10, () => { chain.push('first'); nested.schedule('second', 10, () => chain.push('second')); });
  nested.update(10);
  check('an event scheduled from a callback that is already due runs in the same update', chain.join() === 'first,second');
}

// Damage
{
  const definitions: StatusDefinition[] = [
    { id: 'fire-vuln', name: 'Fire vulnerability', damageTaken: [{ damageType: 'fire', multiplier: 2 }] },
    { id: 'doom', name: 'Doom', damageTaken: [{ fatal: true }] },
    { id: 'fire-doom', name: 'Fire doom', damageTaken: [{ damageType: 'fire', fatal: true }] },
  ];
  const resolver = new DamageResolver(definitions);
  const make = (statuses: string[] = [], health = 100): Player => ({ id: 'p', name: 'P', type: 'player', role: 'damage', mechanicalRoles: [], moveSpeed: 5, health, alive: true, position: { x: 0, y: 0 }, statuses: statuses.map((definitionId) => ({ definitionId, appliedAt: 0, stacks: 1 })) } as unknown as Player);
  const hit = (type: string, amount = 30, fatal?: boolean) => ({ type, amount, ...(fatal === undefined ? {} : { fatal }) }) as never;
  let target = make(); let result = resolver.resolve(target, hit('fire'));
  check('plain damage reduces health', target.health === 70 && target.alive && !result.killed);
  target = make(['fire-vuln']); result = resolver.resolve(target, hit('fire'));
  check('matching vulnerability multiplies damage', target.health === 40 && result.amount === 60);
  target = make(['fire-vuln']); resolver.resolve(target, hit('physical'));
  check('a vulnerability to another type does nothing', target.health === 70);
  target = make([], 30); result = resolver.resolve(target, hit('fire'));
  check('damage equal to health kills and floors health at 0', target.health === 0 && !target.alive && result.killed && !result.fatal);
  target = make(); result = resolver.resolve(target, hit('fire', 1, true));
  check('fatal damage kills regardless of amount', target.health === 0 && !target.alive && result.fatal);
  target = make(['doom']); result = resolver.resolve(target, hit('physical', 1));
  check('a status can make any damage fatal', !target.alive && result.fatal);
  target = make(['fire-doom']); resolver.resolve(target, hit('physical', 1));
  check('a type-specific fatal status ignores other types', target.alive && target.health === 99);
  target = make(['unknown-status']); resolver.resolve(target, hit('fire'));
  check('unknown status ids are ignored', target.health === 70);
}

// Streaks
{
  const flags = (botsHidden = false, shotcallsOff = false): RunFlags => ({ botsHidden, shotcallsOff });
  const counts = (tracker: StreakTracker) => Object.fromEntries(tracker.view().map((row) => [row.id, row.count]));
  const play = (tracker: StreakTracker, player: string, runFlags: RunFlags, succeed = true) => { tracker.beginRun(runFlags); tracker.startRun(player); return succeed ? tracker.succeed() : tracker.fail(); };

  let tracker = new StreakTracker();
  check('a fresh tracker shows nothing', tracker.view().length === 0);
  play(tracker, 'a', flags()); play(tracker, 'a', flags());
  check('successes build the general streak', JSON.stringify(counts(tracker)) === '{"total":2}');
  play(tracker, 'a', flags(), false);
  check('a failure clears every streak', tracker.view().length === 0);

  tracker = new StreakTracker(); play(tracker, 'a', flags(true));
  check('hidden bots build the no-bots streak, which hides the equal general one', tracker.view().map((row) => `${row.id}:${row.count}`).join() === 'noBots:1');
  tracker = new StreakTracker(); play(tracker, 'a', flags(true, true));
  check('zero help overpowers its component streaks while they are not ahead', tracker.view().map((row) => row.id).join() === 'noBotsNoShotcalls');
  play(tracker, 'a', flags(true));
  check('a component streak that pulls ahead is shown again, strongest first', tracker.view().map((row) => `${row.id}:${row.count}`).join() === 'noBotsNoShotcalls:1,noBots:2');

  tracker = new StreakTracker(); play(tracker, 'a', flags());
  tracker.beginRun(flags()); const cleared = tracker.startRun('b');
  check('switching player resets the streak', cleared && tracker.view().length === 0);
  tracker.beginRun(flags()); check('the same player keeps it', !tracker.startRun('b'));

  tracker = new StreakTracker(); tracker.beginRun(flags()); tracker.startRun('a'); tracker.pause(); tracker.succeed();
  check('pausing disqualifies the run', tracker.view().length === 0);
  tracker = new StreakTracker(); tracker.beginRun(flags(), false); tracker.startRun('a'); tracker.succeed();
  check('a run on a kept RNG does not count', tracker.view().length === 0);
  tracker = new StreakTracker(); tracker.beginRun(flags(true, true)); tracker.startRun('a'); tracker.setFlags(flags(false, true), true); tracker.succeed();
  check('a condition lost mid-run stays lost', tracker.view().map((row) => row.id).join() === 'noShotcalls');
  tracker = new StreakTracker(); tracker.beginRun(flags()); tracker.startRun('a'); tracker.setFlags(flags(true, true), true); tracker.succeed();
  check('a condition cannot be gained mid-run', tracker.view().length === 1 && tracker.view()[0].id === 'total');
  tracker = new StreakTracker(); tracker.beginRun(flags()); tracker.setFlags(flags(true, true), false); tracker.startRun('a'); tracker.succeed();
  check('conditions can still change before the run starts', tracker.view()[0].id === 'noBotsNoShotcalls');
  tracker = new StreakTracker(); tracker.beginRun(flags()); tracker.startRun('a'); tracker.succeed();
  check('a run resolves only once', tracker.resolved && !tracker.succeed() && !tracker.fail() && tracker.view()[0].count === 1);
  tracker = new StreakTracker(); tracker.beginRun(flags()); check('an all-bots run (no player) never builds a streak', !tracker.startRun('') && !tracker.succeed() && tracker.view().length === 0);
  check('every streak type has a unique id and the generic one qualifies always', new Set(STREAK_TYPES.map((type) => type.id)).size === STREAK_TYPES.length && STREAK_TYPES.find((type) => type.id === 'total')!.qualifies(flags()));
  check('an overpower cycle is rejected', (() => { try { new StreakTracker([{ id: 'x', label: 'x', qualifies: () => true, overpowers: ['y'], style: { color: '', intensity: 0 } }, { id: 'y', label: 'y', qualifies: () => true, overpowers: ['x'], style: { color: '', intensity: 0 } }]); return false; } catch { return true; } })());
}

// Formatting
{
  check('formatClock', formatClock(0) === '00:00.0' && formatClock(65400) === '01:05.4' && formatClock(600000) === '10:00.0');
  check('status names fall back to a readable id', formatStatusName('fire-vulnerability') === 'Fire Vulnerability' && statusDisplayName('x_y', new Map()) === 'X Y' && statusDisplayName('a', new Map([['a', { name: 'Named' }]])) === 'Named');
}

// Replay run options: defaults while watching, live values back afterwards
{
  const hold = new ViewOptionsHold();
  const live = { shotcallText: false, shotcallTts: false, hideBots: true };
  const shown = hold.hold(live);
  check('entering a replay shows the app defaults', JSON.stringify(shown) === JSON.stringify(DEFAULT_VIEW_OPTIONS) && hold.holding);
  shown.hideBots = true;
  check('the defaults object cannot be corrupted by callers', DEFAULT_VIEW_OPTIONS.hideBots === false && hold.hold({ shotcallText: true, shotcallTts: true, hideBots: true }).hideBots === false);
  check('chained replays keep the first snapshot', JSON.stringify(hold.release()) === JSON.stringify(live) && !hold.holding);
  check('leaving with nothing held restores nothing', hold.release() === undefined);
}

console.log(failures === 0 ? '\ncore check passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
