import type { Entity } from './Entity';

/** Roots, stuns and knocks all suppress regular movement. */
export function canMove(entity: Entity): boolean {
  return !entity.rooted && !entity.stunned && !entity.knock;
}

/** Only a stun prevents changing facing. */
export function canTurn(entity: Entity): boolean {
  return !entity.stunned;
}
