import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { AreaEffect } from '../mechanics/Effect';
import type { LogEntry } from './Log';
import type { ActiveCast } from '../mechanics/Cast';

export interface GameState {
  time: number;
  deltaTime: number;
  currentMechanic?: string;
  players: Player[];
  enemies: Enemy[];
  effects: AreaEffect[];
  casts: ActiveCast[];
  running: boolean;
  completed: boolean;
  log: LogEntry[];
}
