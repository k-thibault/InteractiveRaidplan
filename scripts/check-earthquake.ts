// Run with: npx tsx scripts/check-earthquake.ts
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/simulation/Simulation';
import { deriveSeed } from '../src/dev/BatchRun';
import type { Encounter } from '../src/encounters/Encounter';

const SEEDS = 20;
const encounter = JSON.parse(readFileSync(new URL('../public/encounters/earthquake.json', import.meta.url), 'utf8')) as Encounter;
const priority: Record<string, number> = { h1: 4, h2: 3, mt: 2, ot: 1, m1: 4, m2: 3, r1: 2, r2: 1 };
const lasers = [{ at: 31550, soakers: 1 }, { at: 39100, soakers: 2 }, { at: 58700, soakers: 3 }, { at: 63700, soakers: 3 }, { at: 68700, soakers: 3 }];
const rounds = [24200, 31700, 51300, 59300, 64300];

const problems = new Map<string, number>();
const note = (problem: string): void => { problems.set(problem, (problems.get(problem) ?? 0) + 1); };
const bearing = (p: { x: number; y: number }): number => Math.round(((Math.atan2(p.x, -p.y) * 180) / Math.PI + 360) % 360);

for (let index = 0; index < SEEDS; index += 1) {
  const sim = new Simulation(encounter, { seed: deriveSeed(5, index), replayOutcomes: new Map() });
  sim.start();
  const health = new Map<string, number>();
  const hit = lasers.map(() => new Set<string>());
  const layoutSeen = new Set<number>();
  let rolesChecked = false;
  for (let tick = 0; tick < 7500 && !sim.state.completed && sim.state.deaths.length === 0; tick += 1) {
    sim.tick(1000 / 60);
    const { players, enemies, tethers, time } = sim.state;

    if (!rolesChecked && time > 8300) {
      rolesChecked = true;
      for (let order = 1; order <= 8; order += 1) if (players.filter((p) => p.mechanicalRoles.includes(`bait-${order}`)).length !== 1) note(`soak order ${order} is not held by exactly one player`);
      for (const set of ['set-support', 'set-damage']) {
        const members = players.filter((p) => p.mechanicalRoles.includes(set));
        const flex = members.filter((p) => p.mechanicalRoles.includes('type-flex'));
        if (flex.length !== 1) { note(`${set} does not have exactly one flex`); continue; }
        const orderStatus = (p: typeof flex[0]) => p.statuses.find((s) => ['first', 'second', 'third'].includes(s.definitionId))?.definitionId;
        const pair = members.filter((p) => orderStatus(p) === orderStatus(flex[0]));
        if (pair.length !== 2 || pair.some((p) => priority[p.id] < priority[flex[0].id])) note(`${set} flex is not the later of its pair`);
      }
    }

    if (rounds.some((at) => time >= at && time < at + 17)) {
      const numbers = tethers.map((t) => Number(t.sourceId.slice(4)));
      for (const soaker of players.filter((p) => p.mechanicalRoles.includes('soaker'))) {
        const mine = soaker.mechanicalRoles.filter((r) => /^orb-\d$/.test(r)).map((r) => Number(r.slice(4)));
        const sorted = [...numbers].sort((a, b) => a - b);
        const want = soaker.mechanicalRoles.includes('type-damage') ? sorted[0] : soaker.mechanicalRoles.includes('type-support') ? sorted[sorted.length - 1] : sorted[sorted.length - 2];
        if (mine.length !== 1 || mine[0] !== want) note(`${soaker.id} picked orb ${mine} instead of ${want}`);
      }
    }

    if (time > 24100 && time < 24120) {
      const orbs = enemies.filter((e) => /^orb-\d$/.test(e.id));
      const angles = orbs.map((e) => bearing(e.position));
      if (angles.some((angle, i) => i > 0 && angle <= angles[i - 1])) note('orbs are not numbered clockwise from north');
      const decoys = enemies.filter((e) => /^decoy-\d$/.test(e.id)).map((e) => bearing(e.position) % 90);
      if (decoys.length !== 4 || new Set(decoys).size !== 1) note('decoys do not share one cardinal or intercardinal layout');
      layoutSeen.add(decoys[0]);
    }

    for (const p of players) {
      const before = health.get(p.id) ?? p.health;
      health.set(p.id, p.health);
      if (p.health < before) lasers.forEach((laser, i) => { if (time >= laser.at && time <= laser.at + 300) hit[i].add(p.id); });
    }
  }
  lasers.forEach((laser, i) => { if (hit[i].size !== laser.soakers) note(`laser ${i + 1} hit ${hit[i].size} players instead of its ${laser.soakers} soakers`); });
  if (!sim.state.completed || sim.state.failed) note('all-bot run did not complete');
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failures += 1; }
check(`orb soak roles, picks, layouts and laser hits hold over ${SEEDS} seeds`, problems.size === 0, [...problems].map(([k, v]) => `${v}x ${k}`).join('; '));
process.exit(failures === 0 ? 0 : 1);
