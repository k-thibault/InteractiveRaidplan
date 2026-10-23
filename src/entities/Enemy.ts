import type { Entity, EntityGraphic, EntityStyle } from './Entity';
import type { StatusInstance } from './Status';
import type { FollowSettings } from '../bots/FollowManager';
import type { ActiveCast } from '../mechanics/Cast';

export interface Enemy extends Entity {
  type: 'enemy';
  statuses: StatusInstance[];
  /** Runtime expiry for temporary enemies. */
  expiresAt?: number;
  /** While set, the enemy chases and faces its target. */
  follow?: FollowSettings;
  /** Whether the enemy is currently chasing the controlled player. */
  followsControlled?: boolean;
  /** Drawn even while enemies are hidden. */
  forceVisible?: boolean;
}

/** Whether an enemy is still drawn while enemies are hidden. */
export function shownWhileHidden(enemy: Enemy, casts: readonly ActiveCast[]): boolean {
  return enemy.forceVisible === true || enemy.followsControlled === true || casts.some((cast) => cast.sourceId === enemy.id && cast.revealsCaster);
}

/** Reusable enemy template data. */
export interface EnemyTemplate {
  name?: string;
  style?: EntityStyle;
  graphic?: EntityGraphic;
  /** Drawn even while enemies are hidden. */
  forceVisible?: boolean;
}