import type { Vector2, PositionValue } from '../geometry/Vector2';
import type { PlayerSelector } from './Selector';
import type { GraphicAnchor } from './Graphic';
import type { EnemyTemplate } from '../entities/Enemy';
import type { CastFacing } from './Cast';
import type { KnockParams } from './Knock';
import type { FollowSettings } from '../bots/FollowManager';

export type DamageType = 'physical' | 'magical' | 'dark' | 'fire' | 'ice' | 'water' | 'wind' | 'poison';
export interface DamageDefinition { amount: number; type: DamageType; fatal?: boolean; }
/** `source` targets the effect source; `inside_others` excludes an area's anchor. */
export type EffectTarget = 'inside' | 'inside_others' | 'outside' | 'all' | 'source' | PlayerSelector;
export interface HealEffect { type: 'heal'; target: EffectTarget; amount?: number; full?: boolean; }
export interface MoveEntityEffect { type: 'move_entity'; target: string; position: PositionValue; }
export interface DamageEffect { type: 'damage'; target: EffectTarget; damage: DamageDefinition; }
export interface ApplyStatusEffect {
  type: 'apply_status'; target: EffectTarget; duration?: number; stacks?: number;
  /** Fixed status id. Mutually exclusive with `statusChoices`. */
  status?: string;
  /** Rolled independently for each target when the effect executes. */
  statusChoices?: string[];
}
export interface RemoveStatusEffect { type: 'remove_status'; target: EffectTarget; status: string; stacks?: number; }
export interface StartCastEffect {
  type: 'start_cast'; source?: string; mechanic?: string; facing?: CastFacing; 
  /** Pins the `facing` target id to a replay record. */ 
  replayId?: string;
  /** Fixed cast id. Mutually exclusive with `castChoices`. */
  cast?: string;
  /** Rolled fresh, independently, the moment this effect executes */
  castChoices?: string[];
}
/** Forced movement that suspends regular movement until it finishes. Ignores roots and stuns. */
export interface KnockEffect extends KnockParams { type: 'knock'; target: EffectTarget; }
/** Starts follow mode on `source` (the effect's source entity when unset). */
export interface StartFollowEffect extends FollowSettings { type: 'start_follow'; source?: string; }
/** Ends follow mode on `source` (the effect's source entity when unset). */
export interface StopFollowEffect { type: 'stop_follow'; source?: string; }
/** Counts toward the named batch; see `BatchDefinition`. */
export interface AddToBatchEffect { type: 'add_to_batch'; batch: string; }
/** Collects calls over a window, then runs effects with `$batchCount`. */
export interface BatchDefinition { window?: number; effects: EffectDefinition[]; }
export interface RecalculateRolesEffect { type: 'recalculate_roles'; group?: string; }
export interface RecalculatePositionsEffect { type: 'recalculate_positions'; group?: string; params?: Record<string, number>; }
/** Re-matches facing rules for every player and enemy against the `facing` definitions. */
export interface RecalculateFacingEffect { type: 'recalculate_facing'; group?: string; }
export interface SetMechanicEffect { type: 'set_mechanic'; mechanic: string; }
export interface AreaDefinition {
  shape: 'circle' | 'cone' | 'half_room' | 'donut';
  /** Outer radius for donuts. */
  radius: number;
  /** Donut hole radius. */
  innerRadius?: number;
  angle?: number;
  /** Anchor entity when `position` is unset; `$castTarget` is also valid. */
  source?: string;
  /** Spawn-time targeting mode; `cast_*` reuses the locked cast target. */
  direction?: 'front' | 'back' | 'nearest_player' | 'random_player' | 'cast_direction' | 'cast_target' | 'facing';
  rotationOffset?: number;
  /** Enables replay-safe resolution for nearest/random player direction picks. */
  replayableDirection?: boolean;
  side?: 'north' | 'south';
  element?: DamageType;
  mechanic?: string;
  /** Excludes the source entity from area resolution. */
  excludeSource?: boolean;
  /** Optional named telegraph fill style. */
  telegraphStyle?: string;
  telegraphDuration: number;
  duration: number;
  resolution: AreaResolutionRule[];
  telegraphColor?: string; executionColor?: string; label?: string;
  tags?: string[];
}
export interface SpawnAreaEffect extends Partial<AreaDefinition> {
  type: 'spawn_area';
  area?: string;
  areaGroup?: string;
  source?: string;
  position?: PositionValue;
  /** Instance-level replay id - see `AreaDefinition.replayableDirection`. */
  replayId?: string;
}
export interface AssignDistributionEffect { type: 'assign_distribution'; distribution: string; target: 'participants'; effect: ApplyStatusAssignment; /** Pins each participant's assigned value to a replay record. */ replayId?: string; }
export interface ApplyStatusAssignment { type: 'apply_status'; status: string; duration?: number; }
/** Randomly pairs a status list with the selected players. */
export interface DistributeStatusesEffect {
  type: 'distribute_statuses';
  target: EffectTarget;
  statuses: string[];
  duration?: number;
  /** Pins the whole player-to-status pairing to a replay record. */
  replayId?: string;
}
/** Shows a resource-backed graphic for a limited duration. */
export interface ShowGraphicEffect { type: 'show_graphic'; image: string; anchor?: GraphicAnchor; radius?: number; duration: number; }
/** Runs nested effects after a delay. */
export interface DelayedEffectsEffect { type: 'delayed_effects'; delay: number; effects: EffectDefinition[]; }

/** Stores the currently selected players for later reuse. */
export interface SelectGroupEffect { type: 'select_group'; name: string; selector: PlayerSelector; replayId?: string; }
/** Stores a random subset of a saved group. */
export interface SelectGroupSubsetEffect { type: 'select_group_subset'; from: string; name: string; count: number; replayId?: string; }
/** Runs nested effects once per member of a saved group. */
export interface ForEachGroupEffect { type: 'for_each_group'; group: string; effects: EffectDefinition[]; }
/** Creates a temporary enemy instance. */
export interface SpawnEnemyEffect extends Partial<EnemyTemplate> {
  type: 'spawn_enemy';
  /** Fixed id so later selectors and effects can refer to this enemy. */
  enemyId?: string;
  /** Name of a reusable template in `encounter.enemyTemplates`. */
  enemy?: string;
  position: PositionValue;
  expiresAfter?: number;
  addToGroup?: string;
}
/** Removes a temporary enemy and cancels its active casts. */
export interface RemoveEnemyEffect { type: 'remove_enemy'; id: string; }

export type EffectDefinition = HealEffect | MoveEntityEffect | DamageEffect | ApplyStatusEffect | RemoveStatusEffect | KnockEffect | StartFollowEffect | StopFollowEffect | AddToBatchEffect | StartCastEffect | RecalculateRolesEffect | RecalculatePositionsEffect | RecalculateFacingEffect | SetMechanicEffect | SpawnAreaEffect | AssignDistributionEffect | DistributeStatusesEffect | ShowGraphicEffect | DelayedEffectsEffect | SelectGroupEffect | SelectGroupSubsetEffect | ForEachGroupEffect | SpawnEnemyEffect | RemoveEnemyEffect;
export interface AreaCondition { type: 'player_count'; min?: number; max?: number; }
export interface AreaResolutionRule { condition: AreaCondition; effects: EffectDefinition[]; }
export interface BaseAreaEffect {
  id: string; position: Vector2; rotation: number; createdAt: number; telegraphDuration: number; duration: number;
  radius: number; element?: DamageType; mechanic?: string; resolution?: AreaResolutionRule[]; resolvedAt?: number;
  telegraphColor?: string; executionColor?: string; label?: string; tags?: string[]; sourceId?: string; excludeSource?: boolean; telegraphStyle?: string; areaGroup?: string;
}
export interface CircleArea extends BaseAreaEffect { shape: 'circle'; }
export interface ConeArea extends BaseAreaEffect { shape: 'cone'; angle: number; }
export interface HalfRoomArea extends BaseAreaEffect { shape: 'half_room'; side: 'north' | 'south'; }
export interface DonutArea extends BaseAreaEffect { shape: 'donut'; innerRadius: number; }
export type AreaEffect = CircleArea | ConeArea | HalfRoomArea | DonutArea;
