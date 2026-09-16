import type { DamageDefinition, AreaDefinition, EffectDefinition } from './Effect';
import type { PlayerSelector } from './Selector';
import type { PositionValue } from '../geometry/Vector2';
import type { EnemyTemplate } from '../entities/Enemy';
import type { CastFacing } from './Cast';


interface BaseEvent { id: string; at?: number; after?: string; delay?: number; }
export interface StartCastEvent extends BaseEvent {
  type: 'start_cast'; source: string; mechanic?: string; facing?: CastFacing; replayId?: string;
  /** Fixed cast id. Mutually exclusive with `castChoices`. */
  cast?: string;
  /** Rolled fresh, independently, the moment this event fires */
  castChoices?: string[];
}
export interface RemoveStatusEvent extends BaseEvent { type: 'remove_status'; target: PlayerSelector; status: string; stacks?: number; }
export interface RecalculateRolesEvent extends BaseEvent { type: 'recalculate_roles'; group?: string; }
export interface RecalculatePositionsEvent extends BaseEvent { type: 'recalculate_positions'; group?: string; params?: Record<string, number>; }
export interface SetMechanicEvent extends BaseEvent { type: 'set_mechanic'; mechanic: string; }
export interface ApplyStatusEvent extends BaseEvent { type: 'apply_status'; target: PlayerSelector; status: string; duration?: number; stacks?: number; }
export interface DistributeStatusesEvent extends BaseEvent { type: 'distribute_statuses'; target: PlayerSelector; statuses: string[]; duration?: number; replayId?: string; }
export interface HealEvent extends BaseEvent { type: 'heal'; target: PlayerSelector; amount?: number; full?: boolean; }
export interface DamageEvent extends BaseEvent { type: 'damage'; target: PlayerSelector; damage: DamageDefinition; }
export interface SpawnAreaEvent extends BaseEvent, Partial<AreaDefinition> { type: 'spawn_area'; area?: string; areaGroup?: string; source?: string; position?: PositionValue; replayId?: string; }
/** Visual-only world graphic anchored to a position or entity. */
export interface ShowGraphicEvent extends BaseEvent { type: 'show_graphic'; image: string; source?: string; position?: { x: number; y: number }; radius?: number; duration: number; }
/** Changes the arena background image. */
export interface SetBackgroundEvent extends BaseEvent { type: 'set_background'; image: string; }
/** Timeline form of `SelectGroupEffect`. */
export interface SelectGroupEvent extends BaseEvent { type: 'select_group'; name: string; selector: PlayerSelector; replayId?: string; }
/** See `SelectGroupSubsetEffect`. */
export interface SelectGroupSubsetEvent extends BaseEvent { type: 'select_group_subset'; from: string; name: string; count: number; replayId?: string; }
/** See `ForEachGroupEffect`. */
export interface ForEachGroupEvent extends BaseEvent { type: 'for_each_group'; group: string; effects: EffectDefinition[]; }
/** See `SpawnEnemyEffect`. */
export interface SpawnEnemyEvent extends BaseEvent, Partial<EnemyTemplate> { type: 'spawn_enemy'; enemy?: string; position: PositionValue; expiresAfter?: number; addToGroup?: string; }
/** See `RemoveEnemyEffect`. */
export interface RemoveEnemyEvent extends BaseEvent { type: 'remove_enemy'; id: string; }
export type EncounterEvent = ApplyStatusEvent | DistributeStatusesEvent | HealEvent | DamageEvent | SpawnAreaEvent | StartCastEvent | RemoveStatusEvent | RecalculateRolesEvent | RecalculatePositionsEvent | SetMechanicEvent | ShowGraphicEvent | SetBackgroundEvent | SelectGroupEvent | SelectGroupSubsetEvent | ForEachGroupEvent | SpawnEnemyEvent | RemoveEnemyEvent;
