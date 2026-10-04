import { Random } from './Random';

export interface ShuffleRandomGroup { mode: 'shuffle'; values: unknown[]; }
export interface ChoiceRandomGroup { mode: 'choice'; values: unknown[]; }
/** Produces evenly spaced angles from a random start point. */
export interface RotationRandomGroup { mode: 'rotation'; start: number[]; step: number; count: number; }
export interface OffsetRotationRandomGroup { mode: 'offset_rotation'; from: string; offsets: number[]; step: number; count: number; }
export interface ChainedRotationRandomGroup { mode: 'chained_rotation'; start: number[]; step: number; count: number; offsets: number[]; rounds: number; }
export type RandomGroup = ShuffleRandomGroup | ChoiceRandomGroup | RotationRandomGroup | OffsetRotationRandomGroup | ChainedRotationRandomGroup;
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

/** Single-key objects such as `{ "$neg": "$fireRotation" }` evaluate to a number once every operand is numeric. */
const EXPRESSIONS: Record<string, (operands: number[]) => number> = {
  $add: (operands) => operands.reduce((sum, operand) => sum + operand, 0),
  $sub: ([first, ...rest]) => rest.reduce((total, operand) => total - operand, first),
  $mul: (operands) => operands.reduce((product, operand) => product * operand, 1),
  $neg: ([operand]) => -operand,
};
/** Names that are filled in later (per member / per batch / per cast) and must survive `resolve`. */
const DEFERRED_REFERENCES = ['assignedValue', 'groupMember', 'batchCount', 'castTarget'];
const REFERENCE_PATH = /(?:\.([\w-]+)|\[(\d+)\])/g;

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
      else if (group.mode === 'chained_rotation') this.values.set(name, this.rollChainedRotation(group, random));
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

  /**
   * Expands random-group references. `"$group.field"` replaces the whole string with the (typed) value;
   * `"${group.field}"` does the same, and inside a longer string is spliced in as text, e.g.
   * `"${debuffTiming.shortElement}-crystal"`. Single-key `$add`/`$sub`/`$mul`/`$neg` objects are evaluated.
   * Unknown names resolve to `undefined` (or stay as written inside a longer string).
   */
  resolve<T>(value: T): T {
    if (typeof value === 'string') {
      const whole = /^\$([\w-]+)((?:\.[\w-]+|\[\d+\])*)$/.exec(value) ?? /^\$\{([\w-]+)((?:\.[\w-]+|\[\d+\])*)\}$/.exec(value);
      if (whole) {
        if (DEFERRED_REFERENCES.some((name) => whole[1] === name)) return value;
        return this.lookup(whole[1], whole[2]) as T;
      }
      if (!value.includes('${')) return value;
      return value.replace(/\$\{([\w-]+)((?:\.[\w-]+|\[\d+\])*)\}/g, (text, name: string, path: string) => {
        if (DEFERRED_REFERENCES.includes(name)) return text;
        const resolved = this.lookup(name, path);
        return typeof resolved === 'string' || typeof resolved === 'number' ? String(resolved) : text;
      }) as T;
    }
    if (Array.isArray(value)) return value.map((item) => this.resolve(item)) as T;
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      const expression = entries.length === 1 ? EXPRESSIONS[entries[0][0]] : undefined;
      if (expression) {
        const raw = entries[0][1];
        const operands = (Array.isArray(raw) ? raw : [raw]).map((operand) => this.resolve(operand));
        // Operands that are not numbers yet (deferred references) leave the expression for a later pass.
        if (operands.every((operand) => typeof operand === 'number' && Number.isFinite(operand))) return expression(operands as number[]) as T;
        return { [entries[0][0]]: Array.isArray(raw) ? operands : operands[0] } as T;
      }
      return Object.fromEntries(entries.map(([key, item]) => [key, key === 'distribution' ? item : this.resolve(item)])) as T;
    }
    return value;
  }

  /** Looks up a group/sequence value by name and `.field` / `[index]` path; unknown names give `undefined`. */
  private lookup(name: string, path: string): unknown {
    if (!path && this.sequences.has(name)) return this.nextSequenceValue(name);
    let resolved: unknown = this.values.get(name);
    for (const segment of path.match(REFERENCE_PATH) ?? []) {
      const key = segment.startsWith('.') ? segment.slice(1) : Number(segment.slice(1, -1));
      resolved = resolved == null ? undefined : (resolved as Record<string | number, unknown>)[key];
    }
    return resolved;
  }

  rollDistribution(reference: string): unknown[] {
    const name = reference.startsWith('$') ? reference.slice(1) : reference;
    return this.distributions.has(name) ? this.shuffle(this.distributions.get(name)!.values) : [];
  }

  /** Replaces a per-player/per-member marker with its assigned value. */
  resolveAssigned<T>(value: T, assignedValue: unknown, marker = 'assignedValue'): T {
    if (typeof value === 'string') {
      const match = new RegExp(`^\\$${marker}(?:\\.([\\w-]+)|\\[(\\d+)\\])?$`).exec(value);
      if (!match) return value;
      if (match[1] !== undefined && assignedValue !== null && typeof assignedValue === 'object') return (assignedValue as Record<string, unknown>)[match[1]] as T;
      if (match[2] !== undefined && Array.isArray(assignedValue)) return assignedValue[Number(match[2])] as T;
      return assignedValue as T;
    }
    if (Array.isArray(value)) return value.map((item) => this.resolveAssigned(item, assignedValue, marker)) as T;
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolveAssigned(item, assignedValue, marker)])) as T;
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

  private rollChainedRotation(group: ChainedRotationRandomGroup, random: Random): number[][] {
    const start = group.start[random.integer(0, group.start.length - 1)];
    // Rolled once so every round keeps rotating the same direction. 
    const offset = group.offsets[random.integer(0, group.offsets.length - 1)];
    const rounds: number[][] = [];
    for (let round = 0; round < group.rounds; round += 1) {
      const angles: number[] = [];
      for (let index = 0; index < group.count; index += 1) angles.push(this.wrap(start + index * group.step + round * offset, 360));
      rounds.push(angles);
    }
    return rounds;
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