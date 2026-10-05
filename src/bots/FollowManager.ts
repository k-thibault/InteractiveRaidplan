import { canMove, canTurn } from '../entities/Control';
import { clampToArena } from '../geometry/Arena';
import { distance, normalize, subtract, toPolarAngle } from '../geometry/Vector2';
import type { CastDefinition } from '../mechanics/Cast';
import { resolveEntityReference } from '../mechanics/Selector';
import type { GameState } from '../simulation/GameState';
import type { EntityReference } from './PositionTarget';

/** World units per second when `moveSpeed` is unset. */
export const DEFAULT_FOLLOW_SPEED = 5;

/** Makes a non-player entity chase and face another entity until stopped. */
export interface FollowSettings {
  /** Entity to chase. Omit when chasing a fixed `position` instead. */
  target?: EntityReference;
  /**
   * Fixed point to chase instead of an entity. `cast_target_position` (cast effects only) is the position the
   * triggering cast locked onto when it started; it is resolved to a point when the follow begins.
   */
  position?: { x: number; y: number } | 'cast_target_position';
  /** Gap kept between the two entities, in world units. */
  distance: number;
  moveSpeed?: number;
}

export class FollowManager {
  private readonly casts: Record<string, CastDefinition>;

  constructor(casts: Record<string, CastDefinition> = {}) {
    this.casts = casts;
  }

  update(state: GameState): void {
    for (const enemy of state.enemies) {
      const follow = enemy.follow;
      if (!follow) continue;
      const fixed = follow.position && follow.position !== 'cast_target_position' ? follow.position : undefined;
      const target = fixed ? { id: '', alive: true, position: fixed } : (follow.target ? resolveEntityReference(follow.target, state) : undefined);
      if (!target?.alive || target.id === enemy.id) continue;
      const hold = this.activeHold(state, enemy.id);
      // Closing in only: an enemy already inside the gap stays put.
      const gap = distance(enemy.position, target.position) - follow.distance;
      if (!hold.movement && canMove(enemy) && gap > 0) {
        const step = Math.min(gap, ((follow.moveSpeed ?? DEFAULT_FOLLOW_SPEED) * state.deltaTime) / 1000);
        const direction = normalize(subtract(target.position, enemy.position));
        enemy.position.x += direction.x * step;
        enemy.position.y += direction.y * step;
        // Bosses never leave the arena, even one with a deadly border.
        clampToArena(enemy.position, state.arena);
      }
      // An explicit facing rule takes priority over following.
      const overlapping = target.position.x === enemy.position.x && target.position.y === enemy.position.y;
      if (!hold.facing && canTurn(enemy) && !enemy.facingRuleActive && !overlapping) enemy.facing = toPolarAngle(target.position, enemy.position);
    }
  }

  /** Combines the follow suspensions of every cast the entity is currently casting. */
  private activeHold(state: GameState, entityId: string): { movement: boolean; facing: boolean } {
    const hold = { movement: false, facing: false };
    for (const cast of state.casts) {
      if (cast.sourceId !== entityId) continue;
      const suspend = this.casts[cast.definitionId]?.suspendFollow;
      hold.movement ||= suspend?.movement ?? false;
      hold.facing ||= suspend?.facing ?? false;
    }
    return hold;
  }
}
