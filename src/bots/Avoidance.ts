import { distance, normalize } from '../geometry/Vector2';
import type { Vector2 } from '../geometry/Vector2';

export interface Obstacle { position: Vector2; radius: number; }

/** Distance from `point` to the segment `from`-`to`, and how far along the segment the closest point lies. */
function closestOnSegment(point: Vector2, from: Vector2, to: Vector2): { distance: number; along: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return { distance: distance(point, { x: from.x + dx * t, y: from.y + dy * t }), along: t };
}

/** The point to walk toward so the trip from `from` to `to` stays outside every obstacle; `to` itself when nothing is in the way. */
export function routeAround(from: Vector2, to: Vector2, obstacles: readonly Obstacle[]): Vector2 {
  // Leaving an obstacle comes first: walk straight out of it.
  for (const obstacle of obstacles) {
    const away = distance(from, obstacle.position);
    if (away < obstacle.radius) {
      const out = away === 0 ? { x: 1, y: 0 } : normalize({ x: from.x - obstacle.position.x, y: from.y - obstacle.position.y });
      return { x: obstacle.position.x + out.x * (obstacle.radius + 0.1), y: obstacle.position.y + out.y * (obstacle.radius + 0.1) };
    }
  }
  // A destination inside an obstacle can't be routed around, so the bot walks straight there.
  const blockers = obstacles
    .filter((obstacle) => distance(to, obstacle.position) >= obstacle.radius)
    .map((obstacle) => ({ obstacle, ...closestOnSegment(obstacle.position, from, to) }))
    .filter((hit) => hit.distance < hit.obstacle.radius)
    .sort((a, b) => a.along - b.along);
  if (blockers.length === 0) return to;
  const { obstacle } = blockers[0];
  // Head along the tangent that is closer to the destination, far enough ahead to clear the obstacle.
  const toCentre = { x: obstacle.position.x - from.x, y: obstacle.position.y - from.y };
  const gap = Math.hypot(toCentre.x, toCentre.y);
  const forward = normalize(toCentre);
  const bend = Math.asin(Math.min(1, obstacle.radius / gap));
  const heading = normalize({ x: to.x - from.x, y: to.y - from.y });
  const rotate = (angle: number) => ({ x: forward.x * Math.cos(angle) - forward.y * Math.sin(angle), y: forward.x * Math.sin(angle) + forward.y * Math.cos(angle) });
  const options = [rotate(bend), rotate(-bend)];
  const tangent = options[0].x * heading.x + options[0].y * heading.y >= options[1].x * heading.x + options[1].y * heading.y ? options[0] : options[1];
  const reach = Math.sqrt(Math.max(0, gap * gap - obstacle.radius * obstacle.radius)) + 0.5;
  return { x: from.x + tangent.x * reach, y: from.y + tangent.y * reach };
}
