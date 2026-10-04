import { distance, normalize, subtract, toPolarAngle } from '../geometry/Vector2';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { entityRadius } from '../entities/Entity';
import { DEFAULT_FACING } from '../geometry/Facing';
import { canMove, canTurn } from '../entities/Control';
import type { GameState } from '../simulation/GameState';
import type { Vector2 } from '../geometry/Vector2';
import { BOT_DEADLY_EDGE_INSET, clampToArena, constrainToArena } from '../geometry/Arena';
import { clampDirection } from '../geometry/DirectionClamp';

/** Enemy a player focuses: its `focus` while that enemy exists, otherwise the main boss. */
export function focusedEnemy(state: GameState, focus?: string): Enemy | undefined {
  return (focus === undefined ? undefined : state.enemies.find((enemy) => enemy.id === focus))
    ?? state.enemies.find((enemy) => enemy.id === 'boss')
    ?? state.enemies[0];
}

/** Default heading target for bots without a facing rule. */
export function defaultBossFacing(state: GameState, from: Vector2, focus?: string): number {
  const boss = focusedEnemy(state, focus);
  return boss ? toPolarAngle(boss.position, from) : DEFAULT_FACING;
}

/** Slack in world units so a bot that just arrived at the edge of range is not treated as out of range again. */
const FOCUS_RANGE_TOLERANCE = 0.05;

/** How far outside the focused enemy's indicator a following bot closes in to, in world units. */
export const FOCUS_FOLLOW_MARGIN = 1.3;

/** Where a `followFocus` bot closes in to: the point just outside the focused enemy's indicator on its current side. Undefined while already in range. */
function focusFollowPoint(state: GameState, player: Player): Vector2 | undefined {
  if (!player.followFocus) return undefined;
  const enemy = focusedEnemy(state, player.focus);
  if (!enemy) return undefined;
  const standoff = entityRadius(enemy) + FOCUS_FOLLOW_MARGIN;
  // Closing in only: a bot already inside the range stays put rather than backing off to an exact gap.
  if (distance(player.position, enemy.position) <= standoff + FOCUS_RANGE_TOLERANCE) return undefined;
  const side = normalize(subtract(player.position, enemy.position));
  return { x: enemy.position.x + side.x * standoff, y: enemy.position.y + side.y * standoff };
}

/** Minimum movement step that updates facing. */
const MOVING_EPSILON = 0.01;

export class BotManager {
  update(state: GameState): void {
    for (const player of state.players) {
      if (player.controlled || !player.alive) continue;
      // A bot that wants to move still turns toward its destination while rooted or knocked.
      let wantsToMove = false;
      // Position rules win; with none in play, a bot that follows its focus walks to it.
      const target = player.desiredPosition ?? focusFollowPoint(state, player);
      const followingFocus = player.desiredPosition === undefined && target !== undefined;
      if (target) {
        // Bots never aim past a deadly border, however their position rule was written.
        const destination = { x: target.x, y: target.y };
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
          // A bot following its focus keeps looking at it instead of at where it is walking.
          if (!followingFocus && !player.facingRuleActive && canTurn(player)) player.facing = toPolarAngle({ x: direction.x, y: direction.y }, { x: 0, y: 0 });
          wantsToMove = true;
        }
      }
      if ((!wantsToMove || followingFocus) && !player.facingRuleActive && canTurn(player)) player.facing = defaultBossFacing(state, player.position, player.focus);
    }
  }
}
