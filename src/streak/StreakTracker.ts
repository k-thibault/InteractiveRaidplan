import { GENERIC_STREAK, STREAK_TYPES, type RunFlags, type StreakStyle, type StreakType } from './StreakTypes';

/** One streak line to draw. */
export interface StreakRow {
  id: string;
  label: string;
  count: number;
  style: StreakStyle;
}

const cleanFlags = (): RunFlags => ({ botsHidden: false, shotcallsOff: false });

/** Tracks qualified success streaks for the current player. */
export class StreakTracker {
  private readonly types: readonly StreakType[];
  private readonly counts = new Map<string, number>();
  /** Streak types that supersede each type. */
  private readonly overpoweredBy = new Map<string, string[]>();
  /** Display priority derived from overpower relationships. */
  private readonly rank = new Map<string, number>();
  /** Player associated with the streak. */
  private owner: string | undefined;
  private runPlayer: string | undefined;
  private runFlags: RunFlags = cleanFlags();
  private runCountsSuccess = true;
  private runPaused = false;
  private runResolved = true;

  constructor(types: readonly StreakType[] = STREAK_TYPES) {
    this.types = types;
    for (const type of types) this.overpoweredBy.set(type.id, []);
    for (const type of types) for (const target of this.overpowersOf(type)) this.overpoweredBy.get(target)?.push(type.id);
    for (const type of types) this.rankOf(type.id, new Set());
    this.reset();
  }

  /** Streak ids a type overpowers, including the implicit generic one. */
  private overpowersOf(type: StreakType): string[] {
    return type.id === GENERIC_STREAK ? [...type.overpowers] : [...new Set([...type.overpowers, GENERIC_STREAK])];
  }

  private rankOf(id: string, visiting: Set<string>): number {
    const known = this.rank.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) throw new Error(`Streak overpower cycle at "${id}"`);
    visiting.add(id);
    const type = this.types.find((candidate) => candidate.id === id);
    const value = type ? Math.max(-1, ...this.overpowersOf(type).map((target) => this.rankOf(target, visiting))) + 1 : 0;
    visiting.delete(id);
    this.rank.set(id, value);
    return value;
  }

  /** Clear all streak counts. */
  reset(): void {
    for (const type of this.types) this.counts.set(type.id, 0);
    this.owner = undefined;
  }

  /** Prepare a run; `flags` are the conditions currently in effect. */
  beginRun(flags: RunFlags, countsSuccess = true): void {
    this.runFlags = { ...flags };
    this.runCountsSuccess = countsSuccess;
    this.runPaused = false;
    this.runResolved = false;
    this.runPlayer = undefined;
  }

  /** Start the run and clear the streak if its player changed. */
  startRun(playerId: string): boolean {
    this.runPlayer = playerId || undefined;
    if (this.owner !== undefined && this.owner !== this.runPlayer) { this.reset(); return true; }
    return false;
  }

  /** Update conditions; after start, a condition cannot be regained. */
  setFlags(flags: RunFlags, runStarted: boolean): void {
    if (!runStarted) { this.runFlags = { ...flags }; return; }
    for (const key of Object.keys(this.runFlags) as (keyof RunFlags)[]) this.runFlags[key] = this.runFlags[key] && flags[key];
  }

  /** Pausing disqualifies the run from adding to any streak. */
  pause(): void { this.runPaused = true; }

  /** Record a failure; return whether visible streak state changed. */
  fail(): boolean {
    if (this.runResolved) return false;
    this.runResolved = true;
    const changed = this.view().length > 0;
    this.reset();
    return changed;
  }

  /** Record success; return whether visible streak state changed. */
  succeed(): boolean {
    if (this.runResolved || this.runPlayer === undefined) return false;
    this.runResolved = true;
    if (!this.runCountsSuccess || this.runPaused) return false;
    this.owner = this.runPlayer;
    for (const type of this.types) if (type.qualifies(this.runFlags)) this.counts.set(type.id, (this.counts.get(type.id) ?? 0) + 1);
    return true;
  }

  /** Whether this run has already been resolved */
  get resolved(): boolean { return this.runResolved; }

  /** Return visible streaks in priority order. */
  view(): StreakRow[] {
    const count = (id: string): number => this.counts.get(id) ?? 0;
    return this.types
      .filter((type) => count(type.id) > 0 && (this.overpoweredBy.get(type.id) ?? []).every((id) => count(type.id) > count(id)))
      .sort((a, b) => (this.rank.get(b.id) ?? 0) - (this.rank.get(a.id) ?? 0))
      .map((type) => ({ id: type.id, label: type.label, count: count(type.id), style: type.style }));
  }
}
