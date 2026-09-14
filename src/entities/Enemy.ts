import type { Entity, EntityStyle } from './Entity';
import type { StatusInstance } from './Status';

export interface Enemy extends Entity {
  type: 'enemy';
  statuses: StatusInstance[];
  /** Runtime expiry for temporary enemies. */
  expiresAt?: number;
}

/** Reusable enemy template data. */
export interface EnemyTemplate {
  name?: string;
  style?: EntityStyle;
}