import type { PlayerRole } from '../entities/Player';

export type EntityReference =
  | { type: 'mechanical_role'; role: string }
  | { type: 'gameplay_role'; role: PlayerRole }
  | { type: 'id'; id: string };

export type PositionTarget =
  | { type: 'fixed'; position: { x: number; y: number } | string }
  /**
   * A compass angle (degrees, 0 = north, clockwise) and radius from the
   * arena center (or `origin`). `angle`/`radius` may be `$ref` values, so a
   * role's position can follow a randomly-chosen direction - e.g. standing
   * along the same line as a randomly-placed soak - without the encounter
   * declaring a separate literal x/y for every possible direction.
   */
  | { type: 'polar'; angle: number | string; radius: number | string; origin?: { x: number; y: number } }
  | { type: 'entity'; player: EntityReference; offset?: { x: number; y: number } }
  | { type: 'area'; mechanic?: string; label?: string; offset?: { x: number; y: number } };

export interface PositionRule { when: import('./MechanicalRoleEvaluator').Condition; target: PositionTarget; }
