import type { Entity } from '../entities/Entity';
import { clampToArena } from '../geometry/Arena';
import { angleDelta } from '../geometry/Facing';
import { toPolarAngle } from '../geometry/Vector2';
import type { PositionValue, Vector2 } from '../geometry/Vector2';
import type { GameState } from '../simulation/GameState';

/** Time in ms to cover the knock distance, so longer knocks move faster. */
export const DEFAULT_KNOCK_DURATION = 500;

export type KnockDirection =
  /** Away from an entity id or point; defaults to the center of the resolving area, else the effect's source entity. */
  | { type: 'radial'; from?: string | PositionValue }
  /** Along a fixed compass heading in degrees. */
  | { type: 'linear'; angle: number | string };

/** Rescales a knock for targets holding `status`, depending on how they face the knock's source. */
export interface KnockFacingModifier {
  status: string;
  /** Distance multiplier when facing the source. */
  towards?: number;
  /** Distance multiplier when facing directly away from the source. */
  away?: number;
  /** Width in degrees of each of the towards/away cones. Facings between them leave the knock unchanged. */
  arc?: number;
  /** Remove the status when a multiplier applies. */
  consume?: boolean;
}

export interface KnockParams {
  /** World units travelled over the whole knock. */
  distance: number;
  direction: KnockDirection;
  /** Milliseconds to cover `distance`. */
  duration?: number;
  facingModifiers?: KnockFacingModifier[];
}

/** Returns the facing-based distance multiplier, if the heading falls within either cone. */
export function facingKnockScale(facing: number, heading: Vector2, modifier: KnockFacingModifier): number | undefined {
  const headingAngle = toPolarAngle(heading, { x: 0, y: 0 });
  const half = (modifier.arc ?? 90) / 2;
  if (modifier.towards !== undefined && angleDelta(facing, headingAngle + 180) <= half) return modifier.towards;
  if (modifier.away !== undefined && angleDelta(facing, headingAngle) <= half) return modifier.away;
  return undefined;
}

/** Heading is fixed when the knock starts. */
export interface ActiveKnock {
  /** Unit vector. */
  direction: Vector2;
  /** World units per second. */
  speed: number;
  /** Milliseconds left. */
  remaining: number;
}

/** Moves every knocked entity along its heading, ending the knock when its time is up. */
export function advanceKnocks(state: GameState, deltaMs: number): void {
  for (const entity of [...state.players, ...state.enemies] as Entity[]) {
    const knock = entity.knock;
    if (!knock) continue;
    if (!entity.alive) { entity.knock = undefined; continue; }
    const step = Math.min(deltaMs, knock.remaining);
    entity.position.x += (knock.direction.x * knock.speed * step) / 1000;
    entity.position.y += (knock.direction.y * knock.speed * step) / 1000;
    clampToArena(entity.position);
    knock.remaining -= step;
    if (knock.remaining <= 0) entity.knock = undefined;
  }
}
