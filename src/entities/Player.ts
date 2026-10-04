import type { Entity } from './Entity';
import type { StatusInstance } from './Status';
import type { PositionTarget } from '../bots/PositionTarget';
import type { DirectionClamp } from '../geometry/DirectionClamp';

export type PlayerRole = 'tank' | 'healer' | 'damage';
export type DamagePosition = 'melee' | 'ranged';

export interface Player extends Entity {
  type: 'player';
  health: number;
  maxHealth?: number;
  role: PlayerRole;
  /** Optional mechanical team for paired mechanics. */
  team?: string;
  damagePosition?: DamagePosition;
  flexPriority?: number;
  mechanicalRoles: string[];
  positionTarget?: PositionTarget;
  desiredPosition?: { x: number; y: number };
  movementClamp?: DirectionClamp;
  moveSpeed: number;
  controlled: boolean;
  statuses: StatusInstance[];
}