import { canMove, canTurn } from '../entities/Control';
import type { Player } from '../entities/Player';
import { constrainToArena } from '../geometry/Arena';
import type { Arena } from '../geometry/Arena';
import { quantizeFacing, quantizePosition } from '../geometry/Quantize';
import { toPolarAngle } from '../geometry/Vector2';
import type { Vector2 } from '../geometry/Vector2';

/** Unit-length (or zero) movement direction plus where to face when standing still, if anywhere. */
export interface MovementInput { direction: Vector2; faceTowards?: Vector2; }

/** Applies one movement step and quantizes the resulting position and facing. */
export function stepControlledPlayer(player: Player, arena: Arena, input: MovementInput, deltaSeconds: number): void {
  if (player.alive) {
    const { direction } = input;
    if (direction.x !== 0 || direction.y !== 0) {
      if (canMove(player)) {
        player.position.x += direction.x * player.moveSpeed * deltaSeconds;
        player.position.y += direction.y * player.moveSpeed * deltaSeconds;
      }
      if (canTurn(player)) player.facing = toPolarAngle(direction, { x: 0, y: 0 });
    } else if (input.faceTowards && canTurn(player)) {
      player.facing = toPolarAngle(input.faceTowards, player.position);
    }
    constrainToArena(player.position, arena);
  }
  // Always snap, even when standing still: knocks leave the position off the grid and a recording only stores grid values.
  quantizePosition(player.position);
  if (player.facing !== undefined) player.facing = quantizeFacing(player.facing);
}
