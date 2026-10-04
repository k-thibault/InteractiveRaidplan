import type { Vector2 } from './Vector2';
import { toPolarAngle } from './Vector2';

/** North-facing heading in compass degrees. */
export const DEFAULT_FACING = 0;

/** Shortest angular distance between two headings. */
export function angleDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** Signed shortest turn in degrees (-180, 180] that takes heading `from` to heading `to`; positive is clockwise. */
export function signedAngleDelta(from: number, to: number): number {
  const diff = (((to - from) % 360) + 540) % 360 - 180;
  return diff === -180 ? 180 : diff;
}

/** Tests whether a heading points within `tolerance` degrees of a target. */
export function isFacingTowards(from: Vector2, facing: number, to: Vector2, tolerance = 90): boolean {
  if (from.x === to.x && from.y === to.y) return true;
  return angleDelta(facing, toPolarAngle(to, from)) <= tolerance;
}

/** Tests whether a heading points away from a target. */
export function isFacingAway(from: Vector2, facing: number, to: Vector2, tolerance = 90): boolean {
  return !isFacingTowards(from, facing, to, tolerance);
}
