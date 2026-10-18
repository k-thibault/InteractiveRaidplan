/** Run options a replay overrides while it is being watched. */
export interface ViewOptions { shotcallText: boolean; shotcallTts: boolean; hideBots: boolean; }

export const DEFAULT_VIEW_OPTIONS: Readonly<ViewOptions> = { shotcallText: true, shotcallTts: true, hideBots: false };

/** Swaps the live options for the defaults and remembers them until `release`. */
export class ViewOptionsHold {
  private saved: ViewOptions | undefined;

  get holding(): boolean { return this.saved !== undefined; }

  /** Returns the options to show; while already holding, the first snapshot is kept so chained replays restore the live values. */
  hold(current: ViewOptions): ViewOptions {
    this.saved ??= { ...current };
    return { ...DEFAULT_VIEW_OPTIONS };
  }

  /** Returns the options to restore, or undefined when nothing is held. */
  release(): ViewOptions | undefined {
    const saved = this.saved;
    this.saved = undefined;
    return saved;
  }
}
