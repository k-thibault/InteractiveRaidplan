import type { DamageType } from '../mechanics/Effect';
import type { EffectDefinition } from '../mechanics/Effect';

export interface StatusDefinition {
  id: string;
  name: string;
  damageTaken?: DamageModifier[];
  tags?: string[];
  onRemove?: EffectDefinition[];
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