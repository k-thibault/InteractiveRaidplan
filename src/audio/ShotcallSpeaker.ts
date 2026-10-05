import type { ShotcallState } from '../simulation/GameState';

/**
 * Reads shotcalls aloud with the browser's built-in speech synthesis (no assets or dependencies).
 *
 * Call `update` every frame with the simulation's current shotcall. A shotcall is spoken once, the moment it first
 * appears. Speech is independent of whether the text bar is visible, and a call that was already on screen when TTS
 * is switched on is not read retroactively.
 */
export class ShotcallSpeaker {
  /** Whether the browser can synthesize speech at all. */
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  private enabled = false;
  /** Last shotcall object seen. Each set_shotcall creates a new object, so identity distinguishes repeated identical texts. */
  private lastSeen: ShotcallState | undefined;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.supported;
    if (!this.enabled) this.cancel();
  }

  update(shotcall: ShotcallState | undefined): void {
    if (shotcall === this.lastSeen) return;
    this.lastSeen = shotcall;
    if (shotcall && this.enabled) this.speak(shotcall.text);
  }

  /** Stops speech and forgets the last call, e.g. when the simulation is rebuilt. */
  reset(): void {
    this.lastSeen = undefined;
    this.cancel();
  }

  pause(): void { if (this.supported) window.speechSynthesis.pause(); }
  resume(): void { if (this.supported) window.speechSynthesis.resume(); }

  private speak(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // A newer call supersedes whatever is still being read so audio never lags behind the simulation.
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = document.documentElement.lang || navigator.language || 'en-US';
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  }

  private cancel(): void { if (this.supported) window.speechSynthesis.cancel(); }
}
