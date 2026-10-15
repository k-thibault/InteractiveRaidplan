import type { Vector2 } from './Vector2';

/** Tests whether a point lies in a rotated rectangle extending from `origin`. */
export function pointInLine(point: Vector2, origin: Vector2, rotation: number, length: number, width: number): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const along = dx * Math.cos(rotation) + dy * Math.sin(rotation);
  const across = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
  return along >= 0 && along <= length && Math.abs(across) <= width / 2;
}
