import type { EffectDefinition } from './Effect';

export interface CastDefinition {
  id: string;
  name: string;
  castTime: number;
  visible?: boolean;
  effects: EffectDefinition[];
  /** Default targeting rule for this cast type. */
  facing?: CastFacing;
}

/** Targeting resolves once at cast start. */
export type CastFacing =
  | { type: 'nearest_player'; replayable?: boolean }
  | { type: 'random_player'; replayable?: boolean }
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
}