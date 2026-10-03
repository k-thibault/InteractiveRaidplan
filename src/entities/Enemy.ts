import type { Entity, EntityStyle } from './Entity';
import type { StatusInstance } from './Status';
import type { FollowSettings } from '../bots/FollowManager';

export interface Enemy extends Entity {
  type: 'enemy';
  statuses: StatusInstance[];
  /** Runtime expiry for temporary enemies. */
  expiresAt?: number;
  /** While set, the enemy chases and faces its target. */
  follow?: FollowSettings;
}

/** Reusable enemy template data. */
export interface EnemyTemplate {
  name?: string;
  style?: EntityStyle;
}