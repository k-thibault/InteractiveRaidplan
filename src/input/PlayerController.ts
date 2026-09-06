import { normalize } from '../geometry/Vector2';
import type { Player } from '../entities/Player';

export class PlayerController {
  private readonly keys = new Set<string>();
  private readonly player: Player | undefined;

  constructor(player: Player | undefined) {
    this.player = player;
    window.addEventListener('keydown', (event) => this.keys.add(event.key.toLowerCase()));
    window.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()));
  }

  update(deltaSeconds: number): void {
    if (!this.player || !this.player.alive) return;
    const direction = normalize({ x: Number(this.keys.has('d') || this.keys.has('arrowright')) - Number(this.keys.has('a') || this.keys.has('arrowleft')), y: Number(this.keys.has('s') || this.keys.has('arrowdown')) - Number(this.keys.has('w') || this.keys.has('arrowup')) });
    this.player.position.x += direction.x * this.player.moveSpeed * deltaSeconds;
    this.player.position.y += direction.y * this.player.moveSpeed * deltaSeconds;
    this.player.position.x = Math.max(-14, Math.min(14, this.player.position.x));
    this.player.position.y = Math.max(-9, Math.min(9, this.player.position.y));
  }
}