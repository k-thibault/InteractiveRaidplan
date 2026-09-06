import type { EffectDefinition } from './Effect';

export interface CastDefinition {
  id: string;
  name: string;
  castTime: number;
  visible?: boolean;
  effects: EffectDefinition[];
}

export interface ActiveCast {
  id: string;
  definitionId: string;
  sourceId: string;
  startedAt: number;
  completesAt: number;
}