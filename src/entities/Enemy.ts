import type { Entity } from './Entity';
import type { StatusInstance } from './Status';

export interface Enemy extends Entity {
  type: 'enemy';
  statuses: StatusInstance[];
}