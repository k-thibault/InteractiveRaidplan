import type { PlayerRole } from '../entities/Player';

export type EntityReference =
  | { type: 'mechanical_role'; role: string }
  | { type: 'gameplay_role'; role: PlayerRole }
  | { type: 'id'; id: string };

export type PositionTarget =
  | { type: 'fixed'; position: { x: number; y: number } | string }
  | { type: 'polar'; angle: number | string; radius: number | string; origin?: { x: number; y: number }; angleOffset?: number }
  | { type: 'entity'; player: EntityReference; offset?: { x: number; y: number } }
  | {
      type: 'area';
      mechanic?: string; label?: string; tag?: string;
      aggregate?: 'first' | 'average';
      polar?: { radius: number | string; origin?: { x: number; y: number }; angleOffset?: number };
      offset?: { x: number; y: number };
    };

export interface PositionRule { when: import('./MechanicalRoleEvaluator').Condition; target: PositionTarget; }
