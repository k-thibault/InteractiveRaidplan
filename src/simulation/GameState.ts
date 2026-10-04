import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { AreaEffect } from '../mechanics/Effect';
import type { WorldGraphicInstance } from '../mechanics/Graphic';
import type { LogEntry } from './Log';
import type { ActiveCast } from '../mechanics/Cast';
import type { GroupEntry } from '../mechanics/Group';
import type { MarkerDefinition } from '../encounters/Encounter';
import type { Vector2 } from '../geometry/Vector2';
import type { Arena } from '../geometry/Arena';

export interface GameState {
  time: number;
  /** Playable area and its border rule. */
  arena: Arena;
  deltaTime: number;
  currentMechanic?: string;
  players: Player[];
  enemies: Enemy[];
  effects: AreaEffect[];
  worldGraphics: WorldGraphicInstance[];
  background?: string;
  casts: ActiveCast[];
  running: boolean;
  completed: boolean;
  log: LogEntry[];
  /** Snapshot of entity ids/positions built by group-selection effects. */
  groups: Record<string, GroupEntry[]>;
  /** Static encounter markers, resolved to world positions at simulation creation. */
  markers: Array<MarkerDefinition & { resolvedPosition: Vector2 }>;
}
