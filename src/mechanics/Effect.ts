import type { Vector2 } from '../geometry/Vector2';
import type { PlayerSelector } from './Selector';

export type DamageType = 'physical' | 'magical' | 'dark' | 'fire' | 'ice' | 'poison';
export interface DamageDefinition { amount: number; type: DamageType; fatal?: boolean; }
export type EffectTarget = 'inside' | 'outside' | 'all' | PlayerSelector;
export interface HealEffect { type: 'heal'; target: EffectTarget; amount?: number; full?: boolean; }
export interface DamageEffect { type: 'damage'; target: EffectTarget; damage: DamageDefinition; }
export interface ApplyStatusEffect { type: 'apply_status'; target: EffectTarget; status: string; duration?: number; }
export interface RemoveStatusEffect { type: 'remove_status'; target: PlayerSelector; status: string; }
export interface StartCastEffect { type: 'start_cast'; cast: string; source?: string; mechanic?: string; }
export interface RecalculateRolesEffect { type: 'recalculate_roles'; }
export interface RecalculatePositionsEffect { type: 'recalculate_positions'; }
export interface SetMechanicEffect { type: 'set_mechanic'; mechanic: string; }
export interface SpawnAreaEffect {
  type: 'spawn_area'; source?: string; position?: Vector2; shape: 'circle' | 'cone' | 'half_room';
  radius: number; angle?: number; direction?: 'front' | 'back'; side?: 'north' | 'south'; element?: DamageType; mechanic?: string;
  telegraphDuration: number; duration: number; resolution: AreaResolutionRule[];
}
export interface AssignDistributionEffect { type: 'assign_distribution'; distribution: string; target: 'participants'; effect: ApplyStatusAssignment; }
export interface ApplyStatusAssignment { type: 'apply_status'; status: string; duration?: number; }
export type EffectDefinition = HealEffect | DamageEffect | ApplyStatusEffect | RemoveStatusEffect | StartCastEffect | RecalculateRolesEffect | RecalculatePositionsEffect | SetMechanicEffect | SpawnAreaEffect | AssignDistributionEffect;
export interface AreaCondition { type: 'player_count'; min?: number; max?: number; }
export interface AreaResolutionRule { condition: AreaCondition; effects: EffectDefinition[]; }
export interface BaseAreaEffect {
  id: string; position: Vector2; rotation: number; createdAt: number; telegraphDuration: number; duration: number;
  radius: number; element?: DamageType; mechanic?: string; resolution?: AreaResolutionRule[]; resolvedAt?: number;
}
export interface CircleArea extends BaseAreaEffect { shape: 'circle'; }
export interface ConeArea extends BaseAreaEffect { shape: 'cone'; angle: number; }
export interface HalfRoomArea extends BaseAreaEffect { shape: 'half_room'; side: 'north' | 'south'; }
export type AreaEffect = CircleArea | ConeArea | HalfRoomArea;
