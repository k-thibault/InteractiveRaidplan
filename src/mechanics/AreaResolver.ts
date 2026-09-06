import type { AreaEffect, EffectDefinition } from './Effect';
import type { Player } from '../entities/Player';

export class AreaResolver {
  resolve(effect: AreaEffect, inside: Player[]): EffectDefinition[] {
    const count = inside.length;
    const rule = effect.resolution?.find(({ condition }) => count >= (condition.min ?? 0) && count <= (condition.max ?? Infinity));
    return rule?.effects ?? [];
  }
}