import { distance, normalize, toPolarAngle } from '../geometry/Vector2';
import { DEFAULT_FACING } from '../geometry/Facing';
import { canMove, canTurn } from '../entities/Control';
import type { GameState } from '../simulation/GameState';
import type { Vector2 } from '../geometry/Vector2';
import { BOT_DEADLY_EDGE_INSET, clampToArena, constrainToArena } from '../geometry/Arena';
import { clampDirection } from '../geometry/DirectionClamp';

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
      // A bot that wants to move still turns toward its destination while rooted or knocked.
      let wantsToMove = false;
      if (player.desiredPosition) {
        // Bots never aim past a deadly border, however their position rule was written.
        const destination = { x: player.desiredPosition.x, y: player.desiredPosition.y };
        if (state.arena.edge === 'deadly') clampToArena(destination, state.arena, BOT_DEADLY_EDGE_INSET);
        const remaining = distance(player.position, destination);
        let direction = normalize({ x: destination.x - player.position.x, y: destination.y - player.position.y });
        const step = Math.min(remaining, player.moveSpeed * state.deltaTime / 1000);
        if (player.movementClamp && remaining > step) direction = clampDirection(direction, player.movementClamp);
        if (step > MOVING_EPSILON) {
          if (canMove(player)) {
            player.position.x += direction.x * step;
            player.position.y += direction.y * step;
            constrainToArena(player.position, state.arena);
          }
          if (!player.facingRuleActive && canTurn(player)) player.facing = toPolarAngle({ x: direction.x, y: direction.y }, { x: 0, y: 0 });
          wantsToMove = true;
        }
      }
      if (!wantsToMove && !player.facingRuleActive && canTurn(player)) player.facing = defaultBossFacing(state, player.position);
    }
  }
}
