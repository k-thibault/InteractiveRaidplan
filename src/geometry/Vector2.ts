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

/** Compass-angle position relative to an origin. */
export interface PolarPosition {
  type: 'polar';
  angle: number | string;
  radius: number | string;
  origin?: Vector2;
}

/** A point offset toward a live entity's current position. */
export interface TowardsPosition {
  type: 'towards';
  from: PositionValue;
  target: string;
  distance: number | string;
}

export type PositionValue = Vector2 | PolarPosition | TowardsPosition;

export function isPolarPosition(value: unknown): value is PolarPosition {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'polar';
}

export function isTowardsPosition(value: unknown): value is TowardsPosition {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'towards';
}

export function fromPolar(angleDegrees: number, radius: number, origin: Vector2 = { x: 0, y: 0 }): Vector2 {
  const radians = (angleDegrees * Math.PI) / 180;
  return { x: origin.x + radius * Math.sin(radians), y: origin.y - radius * Math.cos(radians) };
}

export function toPolarAngle(position: Vector2, origin: Vector2 = { x: 0, y: 0 }): number {
  const radians = Math.atan2(position.x - origin.x, -(position.y - origin.y));
  const degrees = (radians * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

export function circularMeanAngle(anglesDegrees: number[]): number {
  const sum = anglesDegrees.reduce(
    (acc, angle) => {
      const radians = (angle * Math.PI) / 180;
      return { x: acc.x + Math.sin(radians), y: acc.y - Math.cos(radians) };
    },
    { x: 0, y: 0 }
  );
  return toPolarAngle(sum, { x: 0, y: 0 });
}

export function resolvePositionValue(value: Vector2 | PolarPosition): Vector2 {
  if (!isPolarPosition(value)) return value;
  const angle = Number(value.angle);
  const radius = Number(value.radius);
  return fromPolar(angle, radius, value.origin);
}