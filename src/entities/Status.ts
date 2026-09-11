import type { DamageType } from '../mechanics/Effect';
import type { EffectDefinition } from '../mechanics/Effect';

export interface StatusDefinition {
  id: string;
  name: string;
  damageTaken?: DamageModifier[];
  tags?: string[];
  character?: string;
  color?: string;
  /** Resource key of an image to draw in place of the default colored badge. */
  icon?: string;
  /** Status exists mechanically but is omitted from HUD status lists. */
  hidden?: boolean;
  onRemove?: EffectDefinition[];
  /**
   * Effects run the moment this status is applied. Commonly used to spawn a
   * short-lived world graphic on the target (e.g. a flash that fades after a
   * couple seconds) independent of how long the status itself lasts.
   */
  onApply?: EffectDefinition[];
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
}