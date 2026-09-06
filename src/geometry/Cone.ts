import { length, subtract, type Vector2 } from './Vector2';

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function pointInCone(point: Vector2, origin: Vector2, rotation: number, radius: number, angle: number): boolean {
  const relative = subtract(point, origin);
  if (length(relative) > radius) return false;
  const pointAngle = Math.atan2(relative.y, relative.x);
  return Math.abs(normalizeAngle(pointAngle - rotation)) <= (angle * Math.PI) / 360;
}