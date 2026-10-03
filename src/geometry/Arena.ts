import type { Vector2 } from './Vector2';

export const ARENA_HALF_WIDTH = 14;
export const ARENA_HALF_HEIGHT = 9;

/** Clamps a position in place to the playable arena. */
export function clampToArena(position: Vector2): void {
  position.x = Math.max(-ARENA_HALF_WIDTH, Math.min(ARENA_HALF_WIDTH, position.x));
  position.y = Math.max(-ARENA_HALF_HEIGHT, Math.min(ARENA_HALF_HEIGHT, position.y));
}
