/** Values shown by the streak display. */
export interface StreakView {
  /** Consecutive successful controlled runs. */
  total: number;
  /** Consecutive successful runs with bots hidden throughout. */
  hiddenBots: number;
  /** Whether all counted runs hid bots. */
  allHidden: boolean;
}

/** Tracks successful runs for the current player; replayed RNG runs don't add to the streak. */
export class StreakTracker {
  private total = 0;
  private hiddenBots = 0;
  /** Player associated with the streak. */
  private owner: string | undefined;
  private runPlayer: string | undefined;
  private runHidden = false;
  private runCountsSuccess = true;
  private runResolved = true;

  /** Clear all streak counts. */
  reset(): void {
    this.total = 0;
    this.hiddenBots = 0;
    this.owner = undefined;
  }

  /** Prepare a run */
  beginRun(botsHidden: boolean, countsSuccess = true): void {
    this.runHidden = botsHidden;
    this.runCountsSuccess = countsSuccess;
    this.runResolved = false;
    this.runPlayer = undefined;
  }

  /** Start the run and clear the streak if its player changed. */
  startRun(playerId: string): boolean {
    this.runPlayer = playerId || undefined;
    if (this.owner !== undefined && this.owner !== this.runPlayer) { this.reset(); return true; }
    return false;
  }

  /** Track whether bots stay hidden for the full run. */
  setBotsHidden(botsHidden: boolean, runStarted: boolean): void {
    if (!runStarted) this.runHidden = botsHidden;
    else if (!botsHidden) this.runHidden = false;
  }

  /** Record a failure; return whether visible streak state changed. */
  fail(): boolean {
    if (this.runResolved) return false;
    this.runResolved = true;
    const changed = this.total > 0;
    this.reset();
    return changed;
  }

  /** Record success; return whether visible streak state changed. */
  succeed(): boolean {
    if (this.runResolved || this.runPlayer === undefined) return false;
    this.runResolved = true;
    if (!this.runCountsSuccess) return false;
    this.owner = this.runPlayer;
    this.total += 1;
    this.hiddenBots = this.runHidden ? this.hiddenBots + 1 : 0;
    return true;
  }

  /** Whether this run has already been resolved */
  get resolved(): boolean { return this.runResolved; }

  view(): StreakView {
    return { total: this.total, hiddenBots: this.hiddenBots, allHidden: this.total > 0 && this.hiddenBots === this.total };
  }
}
