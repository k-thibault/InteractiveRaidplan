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
  /** Optional #rrggbb color of the player's arena indicator. The controlled player is always drawn in the controlled color. */
  color?: string;
  /** Optional mechanical team for paired mechanics. */
  team?: string;
  damagePosition?: DamagePosition;
  flexPriority?: number;
  mechanicalRoles: string[];
  positionTarget?: PositionTarget;
  desiredPosition?: { x: number; y: number };
  movementClamp?: DirectionClamp;
  /** Id of the enemy this player is currently focusing. Bots without a facing rule face it; falls back to the first boss. */
  focus?: string;
  /** While true, a bot with no position rule closes in on its focused enemy and stands just outside its indicator. */
  followFocus?: boolean;
  moveSpeed: number;
  controlled: boolean;
  statuses: StatusInstance[];
}