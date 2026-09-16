import type { Vector2, PositionValue } from '../geometry/Vector2';
import type { PlayerSelector } from './Selector';
import type { GraphicAnchor } from './Graphic';
import type { EnemyTemplate } from '../entities/Enemy';
import type { CastFacing } from './Cast';

export type DamageType = 'physical' | 'magical' | 'dark' | 'fire' | 'ice' | 'poison';
export interface DamageDefinition { amount: number; type: DamageType; fatal?: boolean; }
export type EffectTarget = 'inside' | 'outside' | 'all' | PlayerSelector;
export interface HealEffect { type: 'heal'; target: EffectTarget; amount?: number; full?: boolean; }
export interface DamageEffect { type: 'damage'; target: EffectTarget; damage: DamageDefinition; }
export interface ApplyStatusEffect { type: 'apply_status'; target: EffectTarget; status: string; duration?: number; stacks?: number; }
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
export interface RecalculateRolesEffect { type: 'recalculate_roles'; group?: string; }
export interface RecalculatePositionsEffect { type: 'recalculate_positions'; group?: string; params?: Record<string, number>; }
export interface SetMechanicEffect { type: 'set_mechanic'; mechanic: string; }
export interface AreaDefinition {
  shape: 'circle' | 'cone' | 'half_room';
  radius: number;
  angle?: number;
  /** Anchor entity when `position` is unset; `$castTarget` is also valid. */
  source?: string;
  /** Spawn-time targeting mode; `cast_*` reuses the locked cast target. */
  direction?: 'front' | 'back' | 'nearest_player' | 'random_player' | 'cast_direction' | 'cast_target';
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
  /** Name of a reusable template in `encounter.enemyTemplates`. */
  enemy?: string;
  position: PositionValue;
  expiresAfter?: number;
  addToGroup?: string;
}
/** Removes a temporary enemy and cancels its active casts. */
export interface RemoveEnemyEffect { type: 'remove_enemy'; id: string; }

export type EffectDefinition = HealEffect | DamageEffect | ApplyStatusEffect | RemoveStatusEffect | StartCastEffect | RecalculateRolesEffect | RecalculatePositionsEffect | SetMechanicEffect | SpawnAreaEffect | AssignDistributionEffect | DistributeStatusesEffect | ShowGraphicEffect | DelayedEffectsEffect | SelectGroupEffect | SelectGroupSubsetEffect | ForEachGroupEffect | SpawnEnemyEffect | RemoveEnemyEffect;
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
export type AreaEffect = CircleArea | ConeArea | HalfRoomArea;
