import { Random } from './Random';

export interface ShuffleRandomGroup { mode: 'shuffle'; values: unknown[]; }
export interface ChoiceRandomGroup { mode: 'choice'; values: unknown[]; }
export type RandomGroup = ShuffleRandomGroup | ChoiceRandomGroup;
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
      this.values.set(name, group.mode === 'shuffle' ? random.shuffle(group.values) : group.values[random.integer(0, group.values.length - 1)]);
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
      const match = /^\$([\w-]+)(?:\.(\d+)|\[(\d+)\])?$/.exec(value);
      if (!match) return value;
      if (value.startsWith('$assignedValue')) return value;
      if (match[2] === undefined && match[3] === undefined && this.sequences.has(match[1])) return this.nextSequenceValue(match[1]) as T;
      const stored = this.values.get(match[1]);
      const index = match[2] ?? match[3];
      return (index === undefined ? stored : (stored as unknown[] | undefined)?.[Number(index)]) as T;
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

  private shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.random.integer(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }
}