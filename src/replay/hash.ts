import type { GameState } from '../simulation/GameState';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const scratch = new DataView(new ArrayBuffer(8));

/** FNV-1a over the UTF-16 code units of a string, as an unsigned 32-bit number. */
export function hashString(text: string): number {
  let value = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), FNV_PRIME);
  return value >>> 0;
}

class Hasher {
  value = FNV_OFFSET;
  byte(byte: number): void { this.value = Math.imul(this.value ^ byte, FNV_PRIME); }
  /**
   * Values are rounded to a millionth before hashing. Different engines, browser versions and CPUs can disagree in the last bit of
   * `sin`, `atan2` and friends (Node and Chromium already do, by 1e-16 in a bot's position); that is not a divergence a person could
   * ever see, so it must not be reported as one. Real divergence (a different hit, death, cast or position) is far larger.
   */
  number(value: number | undefined): void {
    const rounded = value === undefined || !Number.isFinite(value) ? (value ?? Number.NaN) : Math.round(value * 1e6);
    scratch.setFloat64(0, rounded + 0); // `+ 0` makes -0 and 0 hash alike
    for (let index = 0; index < 8; index += 1) this.byte(scratch.getUint8(index));
  }
  text(value: string): void { for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); this.byte(code & 0xff); this.byte(code >>> 8); } this.byte(0); }
}

/** Hashes replay-relevant state, excluding untracked controlled-player facing. */
export function hashState(state: GameState): number {
  const hasher = new Hasher();
  hasher.number(state.time);
  for (const player of state.players) {
    hasher.text(player.id); hasher.number(player.position.x); hasher.number(player.position.y);
    if (!player.controlled) hasher.number(player.facing);
    hasher.number(player.health); hasher.byte(player.alive ? 1 : 0);
    for (const status of player.statuses) { hasher.text(status.definitionId); hasher.number(status.stacks); hasher.number(status.expiresAt); }
  }
  for (const enemy of state.enemies) {
    hasher.text(enemy.id); hasher.number(enemy.position.x); hasher.number(enemy.position.y); hasher.number(enemy.facing);
    for (const status of enemy.statuses) { hasher.text(status.definitionId); hasher.number(status.stacks); hasher.number(status.expiresAt); }
  }
  for (const tether of state.tethers) { hasher.text(tether.id); hasher.text(tether.sourceId); hasher.text(tether.targetId); hasher.number(tether.createdAt); hasher.number(tether.baselineLength); hasher.number(tether.expiresAt); }
  for (const enemy of state.enemies) hasher.number(enemy.expiresAt);
  hasher.number(state.casts.length); hasher.number(state.effects.length);
  return hasher.value >>> 0;
}
