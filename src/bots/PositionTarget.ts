import type { PlayerRole } from '../entities/Player';
import type { MarkerQuery } from './MarkerQuery';

export type EntityReference =
  | { type: 'mechanical_role'; role: string }
  | { type: 'gameplay_role'; role: PlayerRole }
  | { type: 'id'; id: string }
  /** Whoever currently holds the tether from `source`, following passes. */
  | { type: 'tether_target'; source: string }
  /** The source or holder of the player's role-linked tether. */
  | { type: 'own_tether_source' }
  | { type: 'own_tether_target' };

/** Keeps points `margin` or more past the line through `origin`, on the side that `to` lies on relative to `from`. */
export interface HalfPlaneConstraint { origin: PositionTarget; from: PositionTarget; to: PositionTarget; margin?: number; }

export type PositionTarget =
  | { type: 'fixed'; position: { x: number; y: number } | string }
  /** Select a fixed marker id or geometric query, optionally nudged by `offset`. */
  | { type: 'marker'; marker?: string; query?: string | MarkerQuery; offset?: { x: number; y: number } }
  /** `angleFrom` uses an entity bearing and `angleFacing` the direction an entity faces; `originEntity` centres the point on an entity; `angleTowards.by` offsets toward (or away when negative) another bearing. */
  | { type: 'polar'; angle?: number | string; angleFrom?: EntityReference; angleFacing?: EntityReference; originEntity?: EntityReference; angleTowards?: { entity: EntityReference; by: number | string }; radius: number | string; origin?: { x: number; y: number }; angleOffset?: number }
  /** Where the ray from `origin` (default centre) at compass `angle` meets the arena border, pulled back by `inset`. */
  | { type: 'edge'; angle?: number | string; angleFrom?: EntityReference; /** Bearing from `origin` to this point, e.g. a marker picked by a query. */ angleTo?: PositionTarget; inset?: number | string; origin?: { x: number; y: number }; /** Degrees added to the bearing, e.g. 180 for the border directly opposite `angleFrom`. */ angleOffset?: number | string }
  /** A point on the line from `a` to `b`: `t` 0 is `a`, 1 is `b`, default 0.5. */
  | { type: 'between'; a: EntityReference; b: EntityReference; t?: number }
  /** Position that moves a following entity to `to`, optionally updating live. */
  | { type: 'drag'; entity: EntityReference; to: PositionTarget; distance?: number }
  | { type: 'entity'; player: EntityReference; offset?: { x: number; y: number } }
  /** Offset from `from`; nested marker queries rank from it by default. `clamp` snaps the shift heading. */
  | { type: 'shift'; from: PositionTarget; toward?: PositionTarget; awayFrom?: PositionTarget; distance: number | string; clamp?: import('../geometry/DirectionClamp').DirectionClamp; /** Degrees the heading is turned clockwise (negative: counterclockwise) before moving, applied after `clamp`. */ angleOffset?: number | string }
  /** A point on a bait line, offset from the centre and source. */
  | { type: 'bait_line'; from: EntityReference; clearance: number; minFromSource?: number; /** Allowed distance before the tangent. */ slack?: number; /** Allowed distance beyond the tangent. */ beyond?: number; /** Turn direction around the centre. */ side?: 'clockwise' | 'counterclockwise' | 'nearest' }
  /** A point along the player's tether. */
  | { type: 'tether_intercept'; minFromSource?: number; margin?: number }
  /**
   * Searches the arena for a point inside as many `constraints` as possible, taken in order of importance.
   * With all of them satisfied the point nearest `anchor` wins; with only a leading subset, the point farthest from `farFrom` (default: nearest `anchor`).
   */
  | { type: 'safe_spot'; constraints: HalfPlaneConstraint[]; anchor: PositionTarget; farFrom?: PositionTarget; /** Grid spacing in world units, default 0.5. */ step?: number }
  | {
      type: 'area';
      mechanic?: string; label?: string; tag?: string;
      aggregate?: 'first' | 'average';
      polar?: { radius: number | string; origin?: { x: number; y: number }; angleOffset?: number };
      offset?: { x: number; y: number };
    };

export interface PositionRule { when: import('./MechanicalRoleEvaluator').Condition; target: PositionTarget; live?: boolean; clamp?: import('../geometry/DirectionClamp').DirectionClamp; }
