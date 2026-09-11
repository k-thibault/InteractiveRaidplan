export interface Vector2 {
  x: number;
  y: number;
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function length(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y);
}

export function normalize(vector: Vector2): Vector2 {
  const size = length(vector);
  return size === 0 ? { x: 0, y: 0 } : { x: vector.x / size, y: vector.y / size };
}

export function distance(a: Vector2, b: Vector2): number {
  return length(subtract(a, b));
}

/**
 * A position expressed as a compass angle (degrees, 0 = north, increasing
 * clockwise: 90 = east, 180 = south, 270 = west) and a radius from an
 * origin. This lets encounter JSON declare positions like "on the
 * north-east intercardinal, 7 units out" without spelling out x/y, and lets
 * that angle be a random reference (e.g. `$soakAngles[0]`) so the resulting
 * position rotates with whatever direction the mechanic actually picked.
 */
export interface PolarPosition {
  type: 'polar';
  angle: number | string;
  radius: number | string;
  origin?: Vector2;
}

export type PositionValue = Vector2 | PolarPosition;

export function isPolarPosition(value: unknown): value is PolarPosition {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'polar';
}

/** Converts a compass angle/radius pair into a world-space offset from `origin` (defaults to the arena center). */
export function fromPolar(angleDegrees: number, radius: number, origin: Vector2 = { x: 0, y: 0 }): Vector2 {
  const radians = (angleDegrees * Math.PI) / 180;
  return { x: origin.x + radius * Math.sin(radians), y: origin.y - radius * Math.cos(radians) };
}

/** Resolves a position value that may already be a plain Vector2 or may still need polar-to-cartesian conversion. Angle/radius must already be numbers (resolve random/`$ref` strings first). */
export function resolvePositionValue(value: PositionValue): Vector2 {
  if (!isPolarPosition(value)) return value;
  const angle = Number(value.angle);
  const radius = Number(value.radius);
  return fromPolar(angle, radius, value.origin);
}