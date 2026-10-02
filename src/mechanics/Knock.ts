import type { Entity } from '../entities/Entity';
import { clampToArena } from '../geometry/Arena';
import type { PositionValue, Vector2 } from '../geometry/Vector2';
import type { GameState } from '../simulation/GameState';

/** Time in ms to cover the knock distance, so longer knocks move faster. */
export const DEFAULT_KNOCK_DURATION = 500;

export type KnockDirection =
  /** Away from an entity id or point; defaults to the effect's source entity. */
  | { type: 'radial'; from?: string | PositionValue }
  /** Along a fixed compass heading in degrees. */
  | { type: 'linear'; angle: number | string };

export interface KnockParams {
  /** World units travelled over the whole knock. */
  distance: number;
  direction: KnockDirection;
  /** Milliseconds to cover `distance`. */
  duration?: number;
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
