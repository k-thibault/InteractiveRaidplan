import type { EffectDefinition } from './Effect';

export interface CastDefinition {
  id: string;
  name: string;
  castTime: number;
  visible?: boolean;
  effects: EffectDefinition[];
  /** Default targeting rule for this cast type. */
  facing?: CastFacing;
  /** Pauses the caster's follow movement and/or facing until the cast completes. */
  suspendFollow?: { movement?: boolean; facing?: boolean };
}

/** Targeting resolves once at cast start. */
export type CastFacing =
  | { type: 'nearest_player'; replayable?: boolean }
  | { type: 'random_player'; replayable?: boolean }
  /** The living player furthest from the caster when the cast starts. */
  | { type: 'farthest_player'; replayable?: boolean }
  | { type: 'entity'; id: string; replayable?: boolean };

export interface ActiveCast {
  id: string;
  definitionId: string;
  sourceId: string;
  startedAt: number;
  completesAt: number;
  /** Entity chosen once at cast start. */
  targetId?: string;
  /** Frozen angle from the caster to the target. */
  direction?: number;
  /** The target's position when the cast started; it does not follow the target afterwards. */
  targetPosition?: { x: number; y: number };
}