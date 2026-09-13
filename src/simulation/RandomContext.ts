import { Random } from './Random';

export interface ShuffleRandomGroup { mode: 'shuffle'; values: unknown[]; }
export interface ChoiceRandomGroup { mode: 'choice'; values: unknown[]; }
/**
 * Produces a list of `count` compass angles (degrees), evenly spaced `step`
 * degrees apart, starting from one randomly-chosen candidate in `start`.
 * This is how an encounter declares "N things arranged around the room,
 * some fixed angle apart, starting somewhere random" without enumerating
 * every rotated copy by hand - e.g. two soaks 90 degrees apart at a random
 * intercardinal is `{ start: [45, 135, 225, 315], step: 90, count: 2 }`.
 * Adding more soaks, a different spacing, or a later second wave is just a
 * different `count`/`step`/`start`, not new hand-written cases.
 */
export interface RotationRandomGroup { mode: 'rotation'; start: number[]; step: number; count: number; }
export interface OffsetRotationRandomGroup { mode: 'offset_rotation'; from: string; offsets: number[]; step: number; count: number; }
export type RandomGroup = ShuffleRandomGroup | ChoiceRandomGroup | RotationRandomGroup | OffsetRotationRandomGroup;
export interface DistributionDefinition { mode: 'shuffle'; values: unknown[]; }
export interface RandomExpression {
  random: {
    integer?: { min: number; max: number };
    choice?: unknown[];
  };
}
export interface SequenceDefinition {
  values: unknown[];
  start: number | 'random' | RandomExpression;
  step: number | RandomExpression;
}

interface SequenceState { definition: SequenceDefinition; currentIndex: number; step: number; }

export class RandomContext {
  private readonly random: Random;
  private readonly values = new Map<string, unknown>();
  private readonly sequences = new Map<string, SequenceState>();
  private readonly distributions = new Map<string, DistributionDefinition>();

  constructor(groups: Record<string, RandomGroup> = {}, sequences: Record<string, SequenceDefinition> = {}, distributions: Record<string, DistributionDefinition> = {}, random: Random) {
    this.random = random;
    for (const [name, group] of Object.entries(groups)) {
      if (group.mode === 'shuffle') this.values.set(name, random.shuffle(group.values));
      else if (group.mode === 'choice') this.values.set(name, group.values[random.integer(0, group.values.length - 1)]);
      else if (group.mode === 'offset_rotation') this.values.set(name, this.rollOffsetRotation(group, random));
      else this.values.set(name, this.rollRotation(group, random));
    }
    for (const [name, definition] of Object.entries(sequences)) {
      if (definition.values.length === 0) continue;
      const start = definition.start === 'random'
        ? random.integer(0, definition.values.length - 1)
        : this.resolveRandom(definition.start, random, definition.values.length - 1);
      const step = this.resolveRandom(definition.step, random, 1);
      this.sequences.set(name, { definition, currentIndex: this.wrap(start, definition.values.length), step });
    }
    for (const [name, definition] of Object.entries(distributions)) this.distributions.set(name, definition);
  }

  resolve<T>(value: T): T {
    if (typeof value === 'string') {
      const match = /^\$([\w-]+)((?:\.[\w-]+|\[\d+\])*)$/.exec(value);
      if (!match) return value;
      if (value.startsWith('$assignedValue')) return value;
      if (!match[2] && this.sequences.has(match[1])) return this.nextSequenceValue(match[1]) as T;
      let resolved: unknown = this.values.get(match[1]);
      const path = match[2].match(/(?:\.([\w-]+)|\[(\d+)\])/g) ?? [];
      for (const segment of path) {
        const key = segment.startsWith('.') ? segment.slice(1) : Number(segment.slice(1, -1));
        resolved = resolved == null ? undefined : (resolved as Record<string | number, unknown>)[key];
      }
      return resolved as T;
    }
    if (Array.isArray(value)) return value.map((item) => this.resolve(item)) as T;
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'distribution' ? item : this.resolve(item)])) as T;
    return value;
  }

  rollDistribution(reference: string): unknown[] {
    const name = reference.startsWith('$') ? reference.slice(1) : reference;
    return this.distributions.has(name) ? this.shuffle(this.distributions.get(name)!.values) : [];
  }

  resolveAssigned<T>(value: T, assignedValue: unknown): T {
    if (typeof value === 'string') {
      const match = /^\$assignedValue(?:\.([\w-]+)|\[(\d+)\])?$/.exec(value);
      if (!match) return value;
      if (match[1] !== undefined && assignedValue !== null && typeof assignedValue === 'object') return (assignedValue as Record<string, unknown>)[match[1]] as T;
      if (match[2] !== undefined && Array.isArray(assignedValue)) return assignedValue[Number(match[2])] as T;
      return assignedValue as T;
    }
    if (Array.isArray(value)) return value.map((item) => this.resolveAssigned(item, assignedValue)) as T;
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolveAssigned(item, assignedValue)])) as T;
    return value;
  }

  private nextSequenceValue(name: string): unknown {
    const sequence = this.sequences.get(name)!;
    const value = sequence.definition.values[sequence.currentIndex];
    sequence.currentIndex = this.wrap(sequence.currentIndex + sequence.step, sequence.definition.values.length);
    return value;
  }

  private resolveRandom(value: number | RandomExpression, random: Random, defaultMax: number): number {
    if (typeof value === 'number') return value;
    if (value.random.integer) return random.integer(value.random.integer.min, value.random.integer.max);
    if (value.random.choice && value.random.choice.length > 0) return Number(value.random.choice[random.integer(0, value.random.choice.length - 1)]);
    return defaultMax;
  }

  private wrap(value: number, length: number): number { return ((value % length) + length) % length; }

  private rollRotation(group: RotationRandomGroup, random: Random): number[] {
    const start = group.start[random.integer(0, group.start.length - 1)];
    const angles: number[] = [];
    for (let index = 0; index < group.count; index += 1) angles.push(this.wrap(start + index * group.step, 360));
    return angles;
  }

  private rollOffsetRotation(group: OffsetRotationRandomGroup, random: Random): number[] {
    const base = this.values.get(group.from);
    const baseAngle = Array.isArray(base) ? Number(base[0]) : 0;
    const offset = group.offsets[random.integer(0, group.offsets.length - 1)];
    const angles: number[] = [];
    for (let index = 0; index < group.count; index += 1) angles.push(this.wrap(baseAngle + offset + index * group.step, 360));
    return angles;
  }

  private shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.random.integer(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }
}