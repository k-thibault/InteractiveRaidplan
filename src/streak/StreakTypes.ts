/** Conditions used to qualify a run for streaks. */
export type RunFlag = 'botsHidden' | 'shotcallsOff';
export type RunFlags = Record<RunFlag, boolean>;

/** Id of the general success streak. */
export const GENERIC_STREAK = 'total';

/** Streak display color and emphasis. */
export interface StreakStyle {
  color: string;
  intensity: number;
}

export interface StreakType {
  id: string;
  label: string;
  /** Whether a successful run meeting these flags adds to this streak. */
  qualifies(flags: RunFlags): boolean;
  /** Streaks hidden while this one has a greater count. */
  overpowers: readonly string[];
  style: StreakStyle;
}

/** Available streak types and their display rules. */
export const STREAK_TYPES: readonly StreakType[] = [
  { id: GENERIC_STREAK, label: 'Success', qualifies: () => true, overpowers: [], style: { color: '#dbe7f2', intensity: 0 } },
  { id: 'noBots', label: 'No bots', qualifies: (f) => f.botsHidden, overpowers: [], style: { color: '#ffd76a', intensity: 0.6 } },
  { id: 'noShotcalls', label: 'No calls', qualifies: (f) => f.shotcallsOff, overpowers: [], style: { color: '#6fd3ff', intensity: 0.6 } },
  {
    id: 'noBotsNoShotcalls', label: 'Zero help',
    qualifies: (f) => f.botsHidden && f.shotcallsOff,
    overpowers: ['noBots', 'noShotcalls'],
    style: { color: '#ff8de6', intensity: 1 },
  },
];
