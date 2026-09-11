import type { DamageDefinition, AreaDefinition } from './Effect';
import type { PlayerSelector } from './Selector';
import type { PositionValue } from '../geometry/Vector2';


interface BaseEvent { id: string; at?: number; after?: string; delay?: number; }
export interface StartCastEvent extends BaseEvent { type: 'start_cast'; source: string; cast: string; mechanic?: string; }
export interface RemoveStatusEvent extends BaseEvent { type: 'remove_status'; target: PlayerSelector; status: string; stacks?: number; }
export interface RecalculateRolesEvent extends BaseEvent { type: 'recalculate_roles'; group?: string; }
export interface RecalculatePositionsEvent extends BaseEvent { type: 'recalculate_positions'; group?: string; }
export interface SetMechanicEvent extends BaseEvent { type: 'set_mechanic'; mechanic: string; }
export interface ApplyStatusEvent extends BaseEvent { type: 'apply_status'; target: PlayerSelector; status: string; duration?: number; stacks?: number; }
export interface HealEvent extends BaseEvent { type: 'heal'; target: PlayerSelector; amount?: number; full?: boolean; }
export interface DamageEvent extends BaseEvent { type: 'damage'; target: PlayerSelector; damage: DamageDefinition; }
export interface SpawnAreaEvent extends BaseEvent, Partial<AreaDefinition> { type: 'spawn_area'; area?: string; areaGroup?: string; source?: string; position?: PositionValue; }
/** Displays a world graphic at a fixed position or on an entity, e.g. to signal an upcoming mechanic. Distinct from the cast bar. */
export interface ShowGraphicEvent extends BaseEvent { type: 'show_graphic'; image: string; source?: string; position?: { x: number; y: number }; radius?: number; duration: number; }
/** Changes the arena background graphic, e.g. partway through a timeline as the encounter shifts phase. */
export interface SetBackgroundEvent extends BaseEvent { type: 'set_background'; image: string; }
export type EncounterEvent = ApplyStatusEvent | HealEvent | DamageEvent | SpawnAreaEvent | StartCastEvent | RemoveStatusEvent | RecalculateRolesEvent | RecalculatePositionsEvent | SetMechanicEvent | ShowGraphicEvent | SetBackgroundEvent;
