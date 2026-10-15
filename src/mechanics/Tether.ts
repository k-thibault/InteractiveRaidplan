import type { Vector2 } from '../geometry/Vector2';
import type { EffectDefinition, EffectTarget } from './Effect';

/** How a tether line is drawn. Widths and dash lengths are world units. */
export interface TetherStyle {
  /** #rrggbb color of the line. */
  color?: string;
  /** Line thickness. Defaults to a thin line. */
  width?: number;
  /** `[drawn, gap]` pattern; solid when unset. */
  dash?: [number, number];
  /** Soft glow around the line. */
  glow?: boolean;
  /** Arrowhead at the target end, showing which way the mechanic points. On by default. */
  arrow?: boolean;
}

/** Applies when length reaches `from`; stages combine with base style, using the highest match. */
export interface TetherLengthStage {
  from: number;
  style: TetherStyle;
}

/**
 * Break conditions use center-to-center length; `stretched`/`shrunk` compare to creation or last pass.
 */
export type TetherBreakCondition =
  | { type: 'too_long'; length: number }
  | { type: 'too_short'; length: number }
  | { type: 'stretched'; amount: number }
  | { type: 'shrunk'; amount: number };

/**
 * Reusable behavior; spawn options override these fields. Hooks target the holder with `tethered` and the source
 * with `tether_source`; cast-target areas use the holder and tether source.
 */
export interface TetherDefinition {
  /** Shown in logs and attributed as the damage source for hook effects. */
  name?: string;
  style?: TetherStyle;
  lengthStages?: TetherLengthStage[];
  /** A player who steps onto the line between the two ends takes the tether over. */
  passable?: boolean;
  /** Extra reach, in world units, beyond a candidate's own radius when deciding whether it is on the line. */
  passTolerance?: number;
  /** The tether breaks as soon as any of these is met. */
  breakWhen?: TetherBreakCondition[];
  /** Break conditions are ignored for this many ms after the tether appears. */
  graceDuration?: number;
  /** The tether ends by itself after this many ms. Runs `onExpire`. */
  duration?: number;
  onBreak?: EffectDefinition[];
  onExpire?: EffectDefinition[];
  /** Runs when the tether moves to a new target. `tethered` is the new holder. */
  onPass?: EffectDefinition[];
}

/** Fields shared by the spawn effect and event. */
export interface TetherSpawnOptions extends TetherDefinition {
  /** Name of a definition in `encounter.tethers`. */
  tether?: string;
  /** Name the tether answers to in `tethered` selectors and `remove_tether`. Defaults to `tether`. */
  label?: string;
  /** Entity the tether comes from. Defaults to the effect's source (the boss). */
  source?: string;
  /** Tethers this entity directly (any entity, not just a player) instead of the selected players. */
  targetEntity?: string;
}

export interface SpawnTetherEffect extends TetherSpawnOptions { type: 'spawn_tether'; /** Players to tether, one tether each. */ target?: EffectTarget; }
export interface RemoveTetherEffect { type: 'remove_tether'; /** Only tethers with this name. */ tether?: string; /** Only tethers from this entity. */ source?: string; /** Only tethers currently on these players. */ target?: EffectTarget; targetEntity?: string; }

/** A live tether with a snapshot of its definition. */
export interface ActiveTether {
  id: string;
  /** What selectors and `remove_tether` match against. */
  tag?: string;
  name: string;
  sourceId: string;
  /** Changes when a passable tether moves to someone else. */
  targetId: string;
  createdAt: number;
  /** Baseline for `stretched`/`shrunk`; reset on creation and pass. */
  baselineLength: number;
  expiresAt?: number;
  style?: TetherStyle;
  lengthStages?: TetherLengthStage[];
  passable: boolean;
  passTolerance: number;
  breakWhen: TetherBreakCondition[];
  graceDuration: number;
  onBreak?: EffectDefinition[];
  onExpire?: EffectDefinition[];
  onPass?: EffectDefinition[];
}

export const DEFAULT_TETHER_STYLE: Required<Pick<TetherStyle, 'color' | 'width' | 'arrow'>> = { color: '#7fd1ff', width: 0.08, arrow: true };

/** Resolves style from defaults, tether overrides, and reached length stages. */
export function resolveTetherStyle(tether: Pick<ActiveTether, 'style' | 'lengthStages'>, length: number): TetherStyle {
  let style: TetherStyle = { ...DEFAULT_TETHER_STYLE, ...tether.style };
  const stages = [...(tether.lengthStages ?? [])].sort((a, b) => a.from - b.from);
  for (const stage of stages) if (length >= stage.from) style = { ...style, ...stage.style };
  return style;
}

/** Whether any break condition is met at this length. */
export function isTetherBroken(tether: Pick<ActiveTether, 'breakWhen' | 'baselineLength'>, length: number): boolean {
  return tether.breakWhen.some((condition) => {
    if (condition.type === 'too_long') return length > condition.length;
    if (condition.type === 'too_short') return length < condition.length;
    if (condition.type === 'stretched') return length >= tether.baselineLength + condition.amount;
    return length <= tether.baselineLength - condition.amount;
  });
}

/**
 * Where a point lies relative to the segment from `from` to `to`: `along` is 0 at `from` and 1 at `to` (outside 0..1 means beyond an end),
 * `offset` the perpendicular distance from the line. Undefined for a zero-length segment.
 */
export function projectOntoSegment(point: Vector2, from: Vector2, to: Vector2): { along: number; offset: number } | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return undefined;
  const px = point.x - from.x;
  const py = point.y - from.y;
  return { along: (px * dx + py * dy) / lengthSquared, offset: Math.abs(px * dy - py * dx) / Math.sqrt(lengthSquared) };
}
