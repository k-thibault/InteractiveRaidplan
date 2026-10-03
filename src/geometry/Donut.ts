import type { Vector2 } from './Vector2';

/** Inclusive on both edges: inner <= distance <= outer. */
export function pointInDonut(point: Vector2, center: Vector2, innerRadius: number, outerRadius: number): boolean {
  const x = point.x - center.x;
  const y = point.y - center.y;
  const squared = x * x + y * y;
  return squared >= innerRadius * innerRadius && squared <= outerRadius * outerRadius;
}
