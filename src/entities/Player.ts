import type { Entity } from './Entity';
import type { StatusInstance } from './Status';
import type { PositionTarget } from '../bots/PositionTarget';

export type PlayerRole = 'tank' | 'healer' | 'damage';

export interface Player extends Entity {
  type: 'player';
  health: number;
  maxHealth?: number;
  role: PlayerRole;
  mechanicalRoles: string[];
  positionTarget?: PositionTarget;
  desiredPosition?: { x: number; y: number };
  moveSpeed: number;
  controlled: boolean;
  statuses: StatusInstance[];
}