import type { Vector2 } from './Vector2';
import { fromPolar, toPolarAngle } from './Vector2';

export interface DirectionClampSpec { step: number; offset?: number }
export type DirectionClamp = 'cardinal' | 'intercardinal' | 'eight-way' | DirectionClampSpec;

const PRESETS: Record<string, DirectionClampSpec> = {
  cardinal: { step: 90, offset: 0 },
  intercardinal: { step: 90, offset: 45 },
  'eight-way': { step: 45, offset: 0 },
};

export function resolveDirectionClamp(clamp: DirectionClamp): DirectionClampSpec {
  return typeof clamp === 'string' ? PRESETS[clamp] : clamp;
}

export function isValidDirectionClamp(clamp: unknown): clamp is DirectionClamp {
  if (typeof clamp === 'string') return clamp in PRESETS;
  if (clamp === null || typeof clamp !== 'object') return false;
  const { step, offset } = clamp as DirectionClampSpec;
  return Number.isFinite(step) && step > 0 && step <= 360 && (offset === undefined || Number.isFinite(offset));
}

export function snapHeading(angle: number, clamp: DirectionClamp): number {
  const { step, offset = 0 } = resolveDirectionClamp(clamp);
  const snapped = offset + Math.round((angle - offset) / step) * step;
  return ((snapped % 360) + 360) % 360;
}

export function clampDirection(direction: Vector2, clamp: DirectionClamp): Vector2 {
  if (direction.x === 0 && direction.y === 0) return direction;
  const heading = fromPolar(snapHeading(toPolarAngle(direction), clamp), 1);
  return { x: Math.abs(heading.x) < 1e-12 ? 0 : heading.x, y: Math.abs(heading.y) < 1e-12 ? 0 : heading.y };
}