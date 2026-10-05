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

export interface ShotcallState {
  text: string;
  createdAt: number;
  expiresAt?: number;
}

/** Recorded the moment a player dies, for statistics and debugging. */
export interface DeathRecord {
  time: number;
  playerId: string;
  playerName: string;
  /** Mechanical roles held when the player died. */
  roles: string[];
  /** What dealt the killing damage: a cast name, an area label, a status, or the arena edge. */
  source: string;
  damageType: string;
  /** Whether the damage was flagged fatal (or made fatal by a status) rather than simply large. */
  fatal: boolean;
}

export interface GameState {
  time: number;
  /** Playable area and its border rule. */
  arena: Arena;
  deltaTime: number;
  currentMechanic?: string;
  shotcall?: ShotcallState;
  players: Player[];
  enemies: Enemy[];
  effects: AreaEffect[];
  worldGraphics: WorldGraphicInstance[];
  background?: string;
  casts: ActiveCast[];
  running: boolean;
  completed: boolean;
  log: LogEntry[];
  /** Every player death so far, in order. */
  deaths: DeathRecord[];
  /** Outcomes rolled while running, keyed by what was rolled (event id for `castChoices`). Random groups are listed separately by the batch runner. */
  rolls: Record<string, string>;
  /** Snapshot of entity ids/positions built by group-selection effects. */
  groups: Record<string, GroupEntry[]>;
  /** Static encounter markers, resolved to world positions at simulation creation. */
  markers: Array<MarkerDefinition & { resolvedPosition: Vector2 }>;
}
