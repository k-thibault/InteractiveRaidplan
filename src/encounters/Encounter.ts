import type { Enemy, EnemyTemplate } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { StatusDefinition } from '../entities/Status';
import type { EncounterEvent } from '../mechanics/Event';
import type { DistributionDefinition, RandomGroup, SequenceDefinition } from '../simulation/RandomContext';
import type { MechanicalRoleDefinitions } from '../bots/MechanicalRoleEvaluator';
import type { PositionDefinition } from '../bots/PositionEvaluator';
import type { MarkerQuery } from '../bots/MarkerQuery';
import type { FacingDefinition } from '../bots/FacingEvaluator';
import type { CastDefinition } from '../mechanics/Cast';
import type { AreaDefinition, BatchDefinition, EffectDefinition } from '../mechanics/Effect';
import type { PolarPosition, Vector2 } from '../geometry/Vector2';
import type { ArenaDefinition } from '../geometry/Arena';

export interface MarkerDefinition {
  /** Stable marker id used by positioning rules. */
  id: string;
  /** Fixed or polar world position. */
  position: Vector2 | PolarPosition;
  /** Render either a text character or a shared graphic resource. */
  character?: string;
  image?: string;
  /** Optional marker border. Omit for no border. */
  border?: { shape: 'square' | 'circle'; radius: number; color?: string };
  /** Color used for the character, or the border when border.color is omitted. */
  color?: string;
}

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
  /** Status ids that mark a run as failed when any player gets one.*/
  failStatuses?: string[];
  /** Arena shape, size and border behaviour. Omit for the legacy 28x18 walled rectangle. */
  arena?: ArenaDefinition;
  /** Resource key for the current arena background. */
  background?: string;
  randomGroups?: Record<string, RandomGroup>;
  sequences?: Record<string, SequenceDefinition>;
  distributions?: Record<string, DistributionDefinition>;
  mechanicalRoles?: MechanicalRoleDefinitions;
  positions?: Record<string, PositionDefinition>;
  /** Static arena markers that can also be used as position targets. */
  markers?: MarkerDefinition[];
  /** Named marker queries for position and facing rules. */
  markerQueries?: Record<string, MarkerQuery>;
  /** Facing rules, grouped like `positions`. Applies to both players and enemies. */
  facing?: Record<string, FacingDefinition>;
  casts?: Record<string, CastDefinition>;
  /** Reusable area definitions referenced by spawn-area effects. */
  areas?: Record<string, AreaDefinition>;
  /** Named batches that gather `add_to_batch` effects over a short window. */
  batches?: Record<string, BatchDefinition>;
  /** Reusable enemy templates referenced by `spawn_enemy` events/effects. */
  enemyTemplates?: Record<string, EnemyTemplate>;
  /** Groups area hits and resolves shared effects when all members are done. */
  areaGroups?: Record<string, { count: number; effects: EffectDefinition[] }>;
  events: EncounterEvent[];
}