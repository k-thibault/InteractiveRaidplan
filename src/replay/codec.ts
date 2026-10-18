import { REPLAY_FORMAT_VERSION } from './format';
import { isRunFlags } from '../streak/RunConditions';
import type { Replay, ReplayHeader } from './format';

/** Unsigned LEB128 varint writer/reader pair, with zigzag for signed values. */
export function writeVarints(values: number[], signed: boolean[] | boolean = false): Uint8Array {
  const bytes: number[] = [];
  values.forEach((value, index) => {
    const isSigned = Array.isArray(signed) ? signed[index % signed.length] : signed;
    // Zigzag keeps small negatives small; the multiply/floor keeps it safe beyond 32 bits.
    let rest = isSigned ? (value >= 0 ? value * 2 : -value * 2 - 1) : value;
    if (!Number.isSafeInteger(rest) || rest < 0) throw new Error(`Cannot encode ${value} as a varint`);
    while (rest >= 0x80) { bytes.push((rest % 0x80) | 0x80); rest = Math.floor(rest / 0x80); }
    bytes.push(rest);
  });
  return Uint8Array.from(bytes);
}

export function readVarints(bytes: Uint8Array, signed: boolean[] | boolean = false): number[] {
  const values: number[] = [];
  let rest = 0; let scale = 1;
  for (const byte of bytes) {
    rest += (byte & 0x7f) * scale;
    if (byte & 0x80) { scale *= 0x80; continue; }
    const isSigned = Array.isArray(signed) ? signed[values.length % signed.length] : signed;
    values.push(isSigned ? (rest % 2 === 0 ? rest / 2 : -(rest + 1) / 2) : rest);
    rest = 0; scale = 1;
  }
  return values;
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/** Position entries are `[tickDelta, dx, dy]`; facing entries are `[tickDelta, value]`. Only the deltas of positions are signed. */
const POSITION_SIGNS = [false, true, true];

/** Serialises a replay to a JSON string: readable header, compact base64 tracks. */
export function serializeReplay(replay: Replay): string {
  return JSON.stringify({
    header: replay.header,
    position: toBase64(writeVarints(replay.position, POSITION_SIGNS)),
    facing: toBase64(writeVarints(replay.facing)),
    checkpoints: toBase64(writeVarints(replay.checkpoints)),
    endHash: replay.endHash,
  });
}

/** Parses and validates a serialised replay. Throws a descriptive error for anything malformed or from a newer format. */
export function parseReplay(text: string): Replay {
  let raw: { header?: ReplayHeader; position?: unknown; facing?: unknown; checkpoints?: unknown; endHash?: unknown };
  try { raw = JSON.parse(text); } catch { throw new Error('Replay file is not valid JSON'); }
  const header = raw.header;
  if (!header || typeof header !== 'object') throw new Error('Replay file has no header');
  if (header.formatVersion !== REPLAY_FORMAT_VERSION) throw new Error(`Unsupported replay format version ${String(header.formatVersion)} (this build reads ${REPLAY_FORMAT_VERSION})`);
  if (typeof raw.position !== 'string' || typeof raw.facing !== 'string' || typeof raw.checkpoints !== 'string' || typeof raw.endHash !== 'number') throw new Error('Replay file is missing a track');
  const position = readVarints(fromBase64(raw.position), POSITION_SIGNS);
  const facing = readVarints(fromBase64(raw.facing));
  if (position.length % 3 !== 0 || facing.length % 2 !== 0) throw new Error('Replay file has a truncated track');
  if (header.runFlags !== undefined && !isRunFlags(header.runFlags)) delete header.runFlags;
  return { header, position, facing, checkpoints: readVarints(fromBase64(raw.checkpoints)), endHash: raw.endHash };
}
