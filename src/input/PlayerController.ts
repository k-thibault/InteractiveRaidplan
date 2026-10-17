import { normalize } from '../geometry/Vector2';
import type { Vector2 } from '../geometry/Vector2';
import type { Player } from '../entities/Player';
import { stepControlledPlayer } from './ControlledMovement';
import type { Arena } from '../geometry/Arena';
import type { PlayerDriver } from '../simulation/PlayerDriver';

export class PlayerController implements PlayerDriver {
  private readonly keys = new Set<string>();
  private readonly player: Player | undefined;
  private readonly arena: Arena;
  private mouseWorldPosition: Vector2 | undefined;
  private faceCursorWhenStill = false;

  constructor(player: Player | undefined, arena: Arena) {
    this.player = player;
    this.arena = arena;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => { this.keys.add(event.key.toLowerCase()); };
  private readonly onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.key.toLowerCase()); };

  /** Removes the keyboard listeners. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keys.clear();
  }

  /** Stores the cursor's world position. */
  setMouseWorldPosition(position: Vector2): void {
    this.mouseWorldPosition = position;
  }

  /** Enables cursor-facing while stationary. */
  setFaceCursorWhenStill(enabled: boolean): void {
    this.faceCursorWhenStill = enabled;
  }

  /** Fixed-step live driver: called once per simulation tick. */
  step(_tick: number, deltaSeconds: number): void {
    if (!this.player) return;
    const direction = normalize({ x: Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft')), y: Number(this.keys.has('s') || this.keys.has('arrowdown')) - Number(this.keys.has('w') || this.keys.has('arrowup')) });
    stepControlledPlayer(this.player, this.arena, { direction, faceTowards: this.faceCursorWhenStill ? this.mouseWorldPosition : undefined }, deltaSeconds);
  }

  /** Walking before Start uses the same step. */
  idle(deltaSeconds: number): void { this.step(-1, deltaSeconds); }
}
