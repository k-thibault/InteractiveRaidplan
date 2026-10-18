import { StreakTracker } from './StreakTracker';
import { GENERIC_STREAK, STREAK_TYPES, type RunFlags, type StreakType } from './StreakTypes';

/** Labels of the streaks a single success with these flags would display; empty for an unassisted-free default run. */
export function runConditionLabels(flags: RunFlags, types: readonly StreakType[] = STREAK_TYPES): string[] {
  const tracker = new StreakTracker(types);
  tracker.beginRun(flags); tracker.startRun('run'); tracker.succeed();
  return tracker.view().filter((row) => row.id !== GENERIC_STREAK).map((row) => row.label);
}

/** True for a value that has the shape of `RunFlags`. */
export function isRunFlags(value: unknown): value is RunFlags {
  const flags = value as Partial<RunFlags> | null;
  return typeof flags === 'object' && flags !== null && typeof flags.botsHidden === 'boolean' && typeof flags.shotcallsOff === 'boolean';
}
