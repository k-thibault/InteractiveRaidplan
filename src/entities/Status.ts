import type { DamageType } from '../mechanics/Effect';
import type { EffectDefinition } from '../mechanics/Effect';

/** Shields the holder from lethal damage. */
export interface DamageImmunity {
  /** `invulnerable` negates all damage; `undying` lets damage through but never below 1 health. */
  mode: 'invulnerable' | 'undying';
  /** Lethal hits absorbed before the status fades. Lasts until it expires when omitted. */
  charges?: number;
}

/** Effects fired at other players who come within range of the holder. */
export interface ProximityTrigger {
  /** Center-to-center distance from the holder. */
  radius: number;
  /** `proximity_target` is the triggering player and `source` the holder. */
  effects: EffectDefinition[];
  /** Fires again on a player who stays in range, at least this many ms after the last hit on them. Fires once per entry when omitted. */
  interval?: number;
  /** Once-per-entry triggers only: the status fades after the first player it hits (the nearest when several enter together). */
  fadeOnTrigger?: boolean;
}

export interface StatusDefinition {
  id: string;
  name: string;
  damageTaken?: DamageModifier[];
  tags?: string[];
  character?: string;
  color?: string;
  /** Allows multiple stacks in a single status instance. */
  maxStacks?: number;
  showStacks?: boolean;
  /** Resource key used instead of the default badge icon. */
  icon?: string;
  /** Hidden from HUD status lists but still active mechanically. */
  hidden?: boolean;
  /**
   * While active, knock effects are ignored entirely: the carrier is not moved, and the knock's facing modifiers
   * (including any `consume` removal of front/back-style statuses) do not trigger. A knock already in progress finishes.
   */
  knockImmune?: boolean;
  /** While active, a root blocks movement and a stun blocks movement and facing changes. */
  control?: 'root' | 'stun';
  /** Runs when the stacks reach `maxStacks`; `source` targets the holder. */
  onMaxStacks?: EffectDefinition[];
  /** Runs on any removal, including expiry. */
  onRemove?: EffectDefinition[];
  /** Runs only when the status times out. */
  onExpire?: EffectDefinition[];
  /** Runs only when the status is removed before it times out. */
  onEarlyRemove?: EffectDefinition[];
  /** Keeps this status when its carrier dies. */
  keepOnDeath?: boolean;
  /** Removal hook to run on death; defaults to none. */
  deathRemovalTrigger?: 'none' | 'remove' | 'early_remove' | 'expire';
  /** If the carrier is dead on removal, `onRemove` effects run on a random living player instead. */
  reassignIfDead?: boolean;
  /**
   * Effects run the moment this status is applied. Commonly used to spawn a
   * short-lived world graphic on the target (e.g. a flash that fades after a
   * couple seconds) independent of how long the status itself lasts.
   */
  onApply?: EffectDefinition[];
  /** While active, lethal damage is prevented; see `DamageDefinition.bypassImmunity` to override. */
  damageImmunity?: DamageImmunity;
  /** While active, players getting near the holder trigger effects. */
  proximity?: ProximityTrigger;
}

export interface DamageModifier {
  damageType?: DamageType;
  fatal?: boolean;
  multiplier?: number;
}

export interface StatusInstance {
  definitionId: string;
  appliedAt: number;
  expiresAt?: number;
  stacks: number;
  /** Lethal hits left for a `damageImmunity` with `charges`. */
  charges?: number;
  /** Runtime state of a `proximity` status. */
  proximity?: { inRange: string[]; lastHit: Record<string, number> };
}