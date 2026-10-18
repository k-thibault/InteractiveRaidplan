import { parseReplay, serializeReplay } from './codec';
import type { Replay } from './format';

/** `replay-<encounter>-<seed>-<local date and time>.json` */
export function replayFileName(replay: Replay, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `replay-${replay.header.encounterId.replace(/[^a-z0-9_-]+/gi, '_')}-${replay.header.seed >>> 0}-${stamp}.json`;
}

/** Browser only: offers the replay as a file download. */
export function downloadReplay(replay: Replay): void {
  const url = URL.createObjectURL(new Blob([serializeReplay(replay)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = replayFileName(replay); document.body.append(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

/** Browser only: reads and validates a replay file. Rejects with a message fit to show the person. */
export async function readReplayFile(file: File): Promise<Replay> {
  if (file.size > 50 * 1024 * 1024) throw new Error('That file is too large to be a replay.');
  return parseReplay(await file.text());
}
