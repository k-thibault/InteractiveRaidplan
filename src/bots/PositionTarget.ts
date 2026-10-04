import type { PlayerRole } from '../entities/Player';
import type { MarkerQuery } from './MarkerQuery';

export type EntityReference =
  | { type: 'mechanical_role'; role: string }
  | { type: 'gameplay_role'; role: PlayerRole }
  | { type: 'id'; id: string };

export type PositionTarget =
  | { type: 'fixed'; position: { x: number; y: number } | string }
  /** Select a fixed marker id or geometric query, optionally nudged by `offset`. */
  | { type: 'marker'; marker?: string; query?: string | MarkerQuery; offset?: { x: number; y: number } }
  /** `angleFrom` uses an entity bearing; `angleTowards.by` offsets toward (or away when negative) another bearing. */
  | { type: 'polar'; angle?: number | string; angleFrom?: EntityReference; angleTowards?: { entity: EntityReference; by: number | string }; radius: number | string; origin?: { x: number; y: number }; angleOffset?: number }
  /** Where the ray from `origin` (default centre) at compass `angle` meets the arena border, pulled back by `inset`. */
  | { type: 'edge'; angle?: number | string; angleFrom?: EntityReference; inset?: number | string; origin?: { x: number; y: number } }
  /** A point on the line from `a` to `b`: `t` 0 is `a`, 1 is `b`, default 0.5. */
  | { type: 'between'; a: EntityReference; b: EntityReference; t?: number }
  /** Position that moves a following entity to `to`, optionally updating live. */
  | { type: 'drag'; entity: EntityReference; to: PositionTarget; distance?: number }
  | { type: 'entity'; player: EntityReference; offset?: { x: number; y: number } }
  /** Offset from `from`; nested marker queries rank from it by default. `clamp` snaps the shift heading. */
  | { type: 'shift'; from: PositionTarget; toward?: PositionTarget; awayFrom?: PositionTarget; distance: number | string; clamp?: import('../geometry/DirectionClamp').DirectionClamp }
  | {
      type: 'area';
      mechanic?: string; label?: string; tag?: string;
      aggregate?: 'first' | 'average';
      polar?: { radius: number | string; origin?: { x: number; y: number }; angleOffset?: number };
      offset?: { x: number; y: number };
    };

export interface PositionRule { when: import('./MechanicalRoleEvaluator').Condition; target: PositionTarget; live?: boolean; clamp?: import('../geometry/DirectionClamp').DirectionClamp; }
