import type { Player } from '../entities/Player';
import { fromFacingUnits, fromPositionUnits } from '../geometry/Quantize';
import type { PlayerDriver } from '../simulation/PlayerDriver';
import type { Replay } from './format';

/**
 * Plays a recorded track back into the controlled player. At the start of each tick it hard-places position and facing,
 * overwriting anything the simulation did to the player since (knocks), exactly like the live driver's snap does.
 * Between entries the last value holds. Tracks are read forward only: to seek backwards, rebuild the simulation and a new driver.
 */
export class ReplayDriver implements PlayerDriver {
  /** False while the facing arrow should be hidden (the facing is not part of the recording at this tick). */
  facingTracked = false;
  private readonly player: Player;
  private readonly positionTicks: number[] = [];
  private readonly positionX: number[] = [];
  private readonly positionY: number[] = [];
  private readonly facingTicks: number[] = [];
  private readonly facingValues: number[] = [];
  private positionIndex = 0;
  private facingIndex = 0;
  private x: number;
  private y: number;
  private facingValue = 0;

  constructor(replay: Replay, player: Player) {
    this.player = player;
    this.x = replay.header.startUnits.x; this.y = replay.header.startUnits.y;
    let tick = 0; let x = this.x; let y = this.y;
    for (let index = 0; index < replay.position.length; index += 3) {
      tick += replay.position[index]; x += replay.position[index + 1]; y += replay.position[index + 2];
      this.positionTicks.push(tick); this.positionX.push(x); this.positionY.push(y);
    }
    tick = 0;
    for (let index = 0; index < replay.facing.length; index += 2) {
      tick += replay.facing[index];
      this.facingTicks.push(tick); this.facingValues.push(replay.facing[index + 1]);
    }
  }

  step(tick: number): void {
    while (this.positionIndex < this.positionTicks.length && this.positionTicks[this.positionIndex] <= tick) {
      this.x = this.positionX[this.positionIndex]; this.y = this.positionY[this.positionIndex]; this.positionIndex += 1;
    }
    while (this.facingIndex < this.facingTicks.length && this.facingTicks[this.facingIndex] <= tick) {
      this.facingValue = this.facingValues[this.facingIndex]; this.facingIndex += 1;
    }
    this.player.position.x = fromPositionUnits(this.x); this.player.position.y = fromPositionUnits(this.y);
    this.facingTracked = this.facingValue !== 0;
    this.player.facing = this.facingTracked ? fromFacingUnits(this.facingValue - 1) : undefined;
  }
}
