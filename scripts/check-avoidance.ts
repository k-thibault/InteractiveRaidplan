// Run with: npx tsx scripts/check-avoidance.ts
import { BOT_DEADLY_EDGE_INSET, clampToArena, resolveArena } from '../src/geometry/Arena';
import { routeAround } from '../src/bots/Avoidance';
import type { Obstacle } from '../src/bots/Avoidance';
import { fromPolar } from '../src/geometry/Vector2';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failures += 1; }

const arena = resolveArena({ shape: 'circle', radius: 8, edge: 'deadly' });
const SPEED = 0.1;

/** Simulates a bot walking toward its goal. */
function walk(start: { x: number; y: number }, goal: { x: number; y: number }, obstacles: Obstacle[], steps = 600) {
  const at = { ...start };
  let clearance = Infinity;
  for (let step = 0; step < steps; step += 1) {
    if (Math.hypot(goal.x - at.x, goal.y - at.y) < 0.05) break;
    const heading = routeAround(at, goal, obstacles, arena);
    const length = Math.min(Math.hypot(heading.x - at.x, heading.y - at.y), SPEED);
    const norm = Math.hypot(heading.x - at.x, heading.y - at.y) || 1;
    at.x += ((heading.x - at.x) / norm) * length;
    at.y += ((heading.y - at.y) / norm) * length;
    clampToArena(at, arena, BOT_DEADLY_EDGE_INSET);
    for (const obstacle of obstacles) clearance = Math.min(clearance, Math.hypot(at.x - obstacle.position.x, at.y - obstacle.position.y) - obstacle.radius);
  }
  return { end: at, clearance, arrived: Math.hypot(goal.x - at.x, goal.y - at.y) < 0.1 };
}
const orb = (x: number, y: number, radius = 1.4): Obstacle => ({ position: { x, y }, radius });

{
  const result = walk({ x: 0, y: 0 }, { x: 6, y: 0 }, [orb(3, 0)]);
  check('a lone obstacle is walked around', result.arrived && result.clearance > -0.01, JSON.stringify(result));
}
{
  const result = walk({ x: 6.3, y: 4.4 }, { x: 6.7, y: -3.6 }, [orb(6.4, 0)]);
  check('no squeezing between an orb and the wall', result.arrived && result.clearance > -0.01, JSON.stringify(result));
}
{
  const result = walk({ x: -6, y: -3 }, { x: 6, y: 3 }, [orb(0, -7), orb(0, 0), orb(0, 7)].map((o) => ({ ...o, radius: 1.4 })));
  check('a line of orbs spanning the arena is rounded through the gaps or ends that exist', result.arrived && result.clearance > -0.01, JSON.stringify(result));
}
{
  const pocket = [orb(0, -1.2), orb(-2.4, 0), orb(2.4, 0)];
  const result = walk({ x: 0, y: 1.5 }, { x: 0, y: -5 }, pocket);
  check('a bot inside a concave pocket backs out and goes the long way round', result.arrived && result.clearance > -0.01, JSON.stringify(result));
}
{
  const set = [0, 90, 180].map((angle) => ({ position: fromPolar(angle, 7), radius: 1.4 }))
    .concat([0, 90, 180, 270].map((angle) => ({ position: fromPolar(angle, 4), radius: 1.4 })));
  const result = walk(fromPolar(225, 1.5), fromPolar(45, 6.5), set);
  check('the orb and decoy layout can be crossed corner to corner', result.arrived && result.clearance > -0.01, JSON.stringify(result));
}
{
  const box = [orb(0, -2.4, 1.4), orb(0, 2.4, 1.4), orb(-2.4, 0, 1.4), orb(2.4, 0, 1.4)];
  const result = walk({ x: 0, y: 0 }, { x: 6, y: 6 }, box, 100);
  check('an unreachable destination never sends a bot through an obstacle', result.clearance > -0.01, JSON.stringify(result));
}
process.exit(failures === 0 ? 0 : 1);
