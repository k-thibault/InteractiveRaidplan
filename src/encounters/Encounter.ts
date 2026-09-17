import type { Enemy, EnemyTemplate } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { StatusDefinition } from '../entities/Status';
import type { EncounterEvent } from '../mechanics/Event';
import type { DistributionDefinition, RandomGroup, SequenceDefinition } from '../simulation/RandomContext';
import type { MechanicalRoleDefinitions } from '../bots/MechanicalRoleEvaluator';
import type { PositionDefinition } from '../bots/PositionEvaluator';
import type { CastDefinition } from '../mechanics/Cast';
import type { AreaDefinition, EffectDefinition } from '../mechanics/Effect';

/** Encounter-owned resources for backgrounds, icons, and world graphics. */
export interface EncounterResources {
  /** Names in the shared graphics library. */
  graphics?: string[];
  /** Resolved graphic URLs for runtime rendering. */
  images?: Record<string, string>;
}

export interface Encounter {
  version: number;
  name: string;
  duration: number;
  players: Player[];
  enemies: Enemy[];
  statuses: StatusDefinition[];
  resources?: EncounterResources;
  /** Resource key for the current arena background. */
  background?: string;
  randomGroups?: Record<string, RandomGroup>;
  sequences?: Record<string, SequenceDefinition>;
  distributions?: Record<string, DistributionDefinition>;
  mechanicalRoles?: MechanicalRoleDefinitions;
  positions?: Record<string, PositionDefinition>;
  casts?: Record<string, CastDefinition>;
  /** Reusable area definitions referenced by spawn-area effects. */
  areas?: Record<string, AreaDefinition>;
  /** Reusable enemy templates referenced by `spawn_enemy` events/effects. */
  enemyTemplates?: Record<string, EnemyTemplate>;
  /** Groups area hits and resolves shared effects when all members are done. */
  areaGroups?: Record<string, { count: number; effects: EffectDefinition[] }>;
  events: EncounterEvent[];
}