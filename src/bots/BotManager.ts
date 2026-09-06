import { distance, normalize } from '../geometry/Vector2';
import type { GameState } from '../simulation/GameState';

export class BotManager {
  update(state: GameState): void {
    for (const player of state.players) {
      if (player.controlled || !player.alive || !player.desiredPosition) continue;
      const direction = normalize({ x: player.desiredPosition.x - player.position.x, y: player.desiredPosition.y - player.position.y });
      const step = Math.min(distance(player.position, player.desiredPosition), player.moveSpeed * state.deltaTime / 1000);
      player.position.x += direction.x * step;
      player.position.y += direction.y * step;
    }
  }
}