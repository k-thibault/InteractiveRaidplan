import type { Vector2 } from '../geometry/Vector2';

export interface Entity {
  id: string;
  name: string;
  position: Vector2;
  alive: boolean;
}