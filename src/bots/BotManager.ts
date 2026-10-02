import { distance, normalize, toPolarAngle } from '../geometry/Vector2';
import { DEFAULT_FACING } from '../geometry/Facing';
import type { GameState } from '../simulation/GameState';
import type { Vector2 } from '../geometry/Vector2';

/** Default heading target for bots without a facing rule. */
export function defaultBossFacing(state: GameState, from: Vector2): number {
  const boss = state.enemies.find((enemy) => enemy.id === 'boss') ?? state.enemies[0];
  return boss ? toPolarAngle(boss.position, from) : DEFAULT_FACING;
}

/** Minimum movement step that updates facing. */
const MOVING_EPSILON = 0.01;

export class BotManager {
  update(state: GameState): void {
    for (const player of state.players) {
      if (player.controlled || !player.alive) continue;
      let moved = false;
      if (player.desiredPosition) {
        const direction = normalize({ x: player.desiredPosition.x - player.position.x, y: player.desiredPosition.y - player.position.y });
        const step = Math.min(distance(player.position, player.desiredPosition), player.moveSpeed * state.deltaTime / 1000);
        if (step > MOVING_EPSILON) {
          player.position.x += direction.x * step;
          player.position.y += direction.y * step;
          if (!player.facingRuleActive) player.facing = toPolarAngle({ x: direction.x, y: direction.y }, { x: 0, y: 0 });
          moved = true;
        }
      }
      if (!moved && !player.facingRuleActive) player.facing = defaultBossFacing(state, player.position);
    }
  }
}
