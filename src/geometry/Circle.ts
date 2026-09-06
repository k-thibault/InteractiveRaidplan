import type { Vector2 } from './Vector2';

export function pointInCircle(point: Vector2, center: Vector2, radius: number): boolean {
  const x = point.x - center.x;
  const y = point.y - center.y;
  return x * x + y * y <= radius * radius;
}