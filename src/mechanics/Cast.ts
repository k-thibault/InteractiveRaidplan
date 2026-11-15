import type { Entity, EntityGraphic } from '../entities/Entity';
import type { EffectDefinition } from './Effect';

/** Replaces the caster's own graphic; fields left out keep the caster's value. */
export type CasterGraphic = Pick<EntityGraphic, 'image'> & Partial<EntityGraphic>;

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
  /** Draws the caster for the length of the cast, even while enemies are hidden. */
  revealCaster?: boolean;
  /** Drawn in place of the caster's graphic until the cast completes. */
  casterGraphic?: CasterGraphic;
}

/** Targeting resolves once at cast start. */
export type CastFacing =
  | { type: 'nearest_player'; replayable?: boolean }
  | { type: 'random_player'; replayable?: boolean }
  /** The living player furthest from the caster when the cast starts. */
  | { type: 'farthest_player'; replayable?: boolean }
  /** Targets a status holder, optionally falling back to a random player. */
  | { type: 'with_status'; status: string; fallback?: 'random_player'; replayable?: boolean }
  | { type: 'entity'; id: string; replayable?: boolean }
  /** Follows a matching tether target; passes redirect the cast. */
  | { type: 'tether'; tether?: string; pick?: 'oldest' | 'nearest' | 'farthest' };

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
  /** Tether tracked by a tether-facing cast. */
  tetherId?: string;
  /** Copied from the definition when the cast starts. */
  revealsCaster?: boolean;
  /** Copied from the definition when the cast starts. */
  casterGraphic?: CasterGraphic;
}

/** The entity's own graphic, replaced by the newest active cast of its that sets `casterGraphic`. */
export function displayedGraphic(entity: Entity, casts: readonly ActiveCast[]): EntityGraphic | undefined {
  const override = [...casts].reverse().find((cast) => cast.sourceId === entity.id && cast.casterGraphic)?.casterGraphic;
  return override ? { ...entity.graphic, ...override } : entity.graphic;
}