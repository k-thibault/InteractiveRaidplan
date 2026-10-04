import type { PlayerRole } from '../entities/Player';

export type EntityReference =
  | { type: 'mechanical_role'; role: string }
  | { type: 'gameplay_role'; role: PlayerRole }
  | { type: 'id'; id: string };

export type PositionTarget =
  | { type: 'fixed'; position: { x: number; y: number } | string }
  /** Position relative to a named encounter marker. */
  | { type: 'marker'; marker: string; offset?: { x: number; y: number } }
  /** `angleFrom` takes the bearing of an entity from `origin` instead of a fixed `angle`. */
  | { type: 'polar'; angle?: number | string; angleFrom?: EntityReference; radius: number | string; origin?: { x: number; y: number }; angleOffset?: number }
  /** A point on the line from `a` to `b`: `t` 0 is `a`, 1 is `b`, default 0.5. */
  | { type: 'between'; a: EntityReference; b: EntityReference; t?: number }
  /** Position that moves a following entity to `to`, optionally updating live. */
  | { type: 'drag'; entity: EntityReference; to: PositionTarget; distance?: number }
  | { type: 'entity'; player: EntityReference; offset?: { x: number; y: number } }
  /** Offsets a position toward or away from another position. */
  | { type: 'shift'; from: PositionTarget; toward?: PositionTarget; awayFrom?: PositionTarget; distance: number | string }
  | {
      type: 'area';
      mechanic?: string; label?: string; tag?: string;
      aggregate?: 'first' | 'average';
      polar?: { radius: number | string; origin?: { x: number; y: number }; angleOffset?: number };
      offset?: { x: number; y: number };
    };

export interface PositionRule { when: import('./MechanicalRoleEvaluator').Condition; target: PositionTarget; live?: boolean; }
