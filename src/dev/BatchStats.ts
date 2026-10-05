import type { RunOutcome } from './BatchRun';

/** A count of first deaths (or of all deaths) grouped by some label. */
export interface Tally { label: string; count: number; /** Of the failed attempts (or of all deaths, for `allDeathsBySource`), 0 to 1. */ share: number; /** Mean time of these deaths in ms. */ meanTime: number; }
export interface RollRow { value: string; runs: number; failures: number; /** failures / runs, 0 to 1. */ rate: number; }
export interface RollBreakdown { group: string; rows: RollRow[]; }
export interface Spread { mean: number; median: number; min: number; max: number; }

export interface BatchReport {
  runs: number;
  passed: number;
  failed: number;
  /** Attempts that threw and are left out of everything else. */
  errored: number;
  errors: string[];
  /** Seeds of failed attempts, ascending, so they can be replayed. */
  failedSeeds: number[];
  /** Time of the first death across failed attempts. */
  firstDeathTime?: Spread;
  /** Mean deaths per failed attempt; only meaningful when the attempts ran to the end. */
  meanDeathsPerFailure: number;
  /** All tallies below count the first death of each failed attempt. */
  byPlayer: Tally[];
  /** A player holding several roles counts toward each of them. */
  byRole: Tally[];
  bySource: Tally[];
  bySourceAndPlayer: Tally[];
  /** Every death, not just the first; differs from `bySource` only for attempts that ran to the end. */
  allDeathsBySource: Tally[];
  /** Failure rate per rolled outcome, using the rolls made before the first death. */
  rolls: RollBreakdown[];
}

function tally(entries: { label: string; time: number }[], total = entries.length): Tally[] {
  const groups = new Map<string, number[]>();
  for (const { label, time } of entries) groups.set(label, [...(groups.get(label) ?? []), time]);
  return [...groups.entries()]
    .map(([label, times]) => ({ label, count: times.length, share: times.length / total, meanTime: times.reduce((sum, time) => sum + time, 0) / times.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function spread(values: number[]): Spread | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0], max: sorted[sorted.length - 1],
  };
}

/** Rolls that never varied (one value in every attempt) say nothing about failures and are dropped. */
function rollBreakdown(outcomes: RunOutcome[]): RollBreakdown[] {
  const table = new Map<string, Map<string, { runs: number; failures: number }>>();
  for (const outcome of outcomes) {
    for (const [group, value] of Object.entries(outcome.rolls)) {
      const rows = table.get(group) ?? new Map();
      const row = rows.get(value) ?? { runs: 0, failures: 0 };
      row.runs += 1;
      if (outcome.deaths.length > 0) row.failures += 1;
      rows.set(value, row); table.set(group, rows);
    }
  }
  return [...table.entries()]
    .filter(([, rows]) => rows.size > 1)
    .map(([group, rows]) => ({
      group,
      rows: [...rows.entries()].map(([value, { runs, failures }]) => ({ value, runs, failures, rate: failures / runs })).sort((a, b) => b.rate - a.rate || a.value.localeCompare(b.value)),
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

export function summarize(outcomes: RunOutcome[]): BatchReport {
  const errored = outcomes.filter((outcome) => outcome.error !== undefined);
  const valid = outcomes.filter((outcome) => outcome.error === undefined);
  const failedRuns = valid.filter((outcome) => outcome.deaths.length > 0);
  const firstDeaths = failedRuns.map((outcome) => outcome.deaths[0]);
  const allDeaths = failedRuns.flatMap((outcome) => outcome.deaths);
  return {
    runs: outcomes.length,
    passed: valid.length - failedRuns.length,
    failed: failedRuns.length,
    errored: errored.length,
    errors: [...new Set(errored.map((outcome) => outcome.error!))],
    failedSeeds: failedRuns.map((outcome) => outcome.seed).sort((a, b) => a - b),
    firstDeathTime: spread(firstDeaths.map((death) => death.time)),
    meanDeathsPerFailure: failedRuns.length ? allDeaths.length / failedRuns.length : 0,
    byPlayer: tally(firstDeaths.map((death) => ({ label: death.playerName, time: death.time }))),
    byRole: tally(firstDeaths.flatMap((death) => (death.roles.length ? death.roles : ['(no role)']).map((role) => ({ label: role, time: death.time }))), firstDeaths.length),
    bySource: tally(firstDeaths.map((death) => ({ label: `${death.source} (${death.damageType}${death.fatal ? '' : ', by damage amount'})`, time: death.time }))),
    bySourceAndPlayer: tally(firstDeaths.map((death) => ({ label: `${death.playerName} ← ${death.source}`, time: death.time }))),
    allDeathsBySource: tally(allDeaths.map((death) => ({ label: `${death.source} (${death.damageType})`, time: death.time }))),
    rolls: rollBreakdown(valid),
  };
}
