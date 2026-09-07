import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { StatusDefinition } from '../entities/Status';
import type { EncounterEvent } from '../mechanics/Event';
import type { DistributionDefinition, RandomGroup, SequenceDefinition } from '../simulation/RandomContext';
import type { MechanicalRoleDefinition } from '../bots/MechanicalRoleEvaluator';
import type { PositionDefinition } from '../bots/PositionEvaluator';
import type { CastDefinition } from '../mechanics/Cast';

/** Named image resources an encounter can reference for backgrounds, status icons, and world graphics. Values are any URL an <img>/Image can load, including data: URIs. */
export interface EncounterResources {
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
  /** Resource key of the initial arena background. Change it mid-timeline with a `set_background` event. */
  background?: string;
  randomGroups?: Record<string, RandomGroup>;
  sequences?: Record<string, SequenceDefinition>;
  distributions?: Record<string, DistributionDefinition>;
  mechanicalRoles?: Record<string, MechanicalRoleDefinition>;
  positions?: Record<string, PositionDefinition>;
  casts?: Record<string, CastDefinition>;
  events: EncounterEvent[];
}