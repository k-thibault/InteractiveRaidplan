import { normalize, toPolarAngle } from '../geometry/Vector2';
import type { Vector2 } from '../geometry/Vector2';
import type { Player } from '../entities/Player';
import { canMove, canTurn } from '../entities/Control';
import { clampToArena } from '../geometry/Arena';

export class PlayerController {
  private readonly keys = new Set<string>();
  private readonly player: Player | undefined;
  private mouseWorldPosition: Vector2 | undefined;
  private faceCursorWhenStill = false;

  constructor(player: Player | undefined) {
    this.player = player;
    window.addEventListener('keydown', (event) => this.keys.add(event.key.toLowerCase()));
    window.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()));
  }

  /** Stores the cursor's world position. */
  setMouseWorldPosition(position: Vector2): void {
    this.mouseWorldPosition = position;
  }

  /** Enables cursor-facing while stationary. */
  setFaceCursorWhenStill(enabled: boolean): void {
    this.faceCursorWhenStill = enabled;
  }

  update(deltaSeconds: number): void {
    if (!this.player || !this.player.alive) return;
    const direction = normalize({ x: Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft')), y: Number(this.keys.has('s') || this.keys.has('arrowdown')) - Number(this.keys.has('w') || this.keys.has('arrowup')) });
    if (direction.x !== 0 || direction.y !== 0) {
      if (canMove(this.player)) {
        this.player.position.x += direction.x * this.player.moveSpeed * deltaSeconds;
        this.player.position.y += direction.y * this.player.moveSpeed * deltaSeconds;
      }
      if (canTurn(this.player)) this.player.facing = toPolarAngle(direction, { x: 0, y: 0 });
    } else if (this.faceCursorWhenStill && this.mouseWorldPosition && canTurn(this.player)) {
      this.player.facing = toPolarAngle(this.mouseWorldPosition, this.player.position);
    }
    clampToArena(this.player.position);
  }
}
