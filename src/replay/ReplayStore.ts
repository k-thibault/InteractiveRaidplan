import { parseReplay, serializeReplay } from './codec';
import type { Replay } from './format';

/** How long a replay from a previous app session is kept before it is purged. */
export const HISTORY_RETENTION_HOURS = 24;
/** Recent activity window used to protect replays from an open session. */
export const SESSION_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

/** What the history list shows, kept next to the data so listing never needs to decode a replay. */
export interface ReplaySummary {
  encounterId: string;
  seed: number;
  controlledPlayerId?: string;
  controlledPlayerName?: string;
  tickMs: number;
  endTick: number;
  completed: boolean;
  deathCount: number;
}

export interface StoredReplay {
  id: string;
  /** The app session (page load) that recorded it. */
  sessionId: string;
  /** Epoch ms. */
  savedAt: number;
  summary: ReplaySummary;
  /** The serialised replay file text. */
  data: string;
}

/** Storage interface for replay data and session activity. */
export interface ReplayStorage {
  putReplay(record: StoredReplay): Promise<void>;
  listReplays(): Promise<StoredReplay[]>;
  getReplay(id: string): Promise<StoredReplay | undefined>;
  deleteReplays(ids: string[]): Promise<void>;
  /** Records that `sessionId` was active at `at`. */
  touchSession(sessionId: string, at: number): Promise<void>;
  /** Last-active time of every known session. */
  sessionActivity(): Promise<Record<string, number>>;
  deleteSessions(ids: string[]): Promise<void>;
}

export class MemoryStorage implements ReplayStorage {
  private readonly replays = new Map<string, StoredReplay>();
  private readonly sessions = new Map<string, number>();
  async putReplay(record: StoredReplay): Promise<void> { this.replays.set(record.id, record); }
  async listReplays(): Promise<StoredReplay[]> { return [...this.replays.values()]; }
  async getReplay(id: string): Promise<StoredReplay | undefined> { return this.replays.get(id); }
  async deleteReplays(ids: string[]): Promise<void> { ids.forEach((id) => this.replays.delete(id)); }
  async touchSession(sessionId: string, at: number): Promise<void> { this.sessions.set(sessionId, at); }
  async sessionActivity(): Promise<Record<string, number>> { return Object.fromEntries(this.sessions); }
  async deleteSessions(ids: string[]): Promise<void> { ids.forEach((id) => this.sessions.delete(id)); }
}

export interface HistoryOptions {
  /** Identifies this page load; replays it saves belong to it. */
  sessionId: string;
  retentionHours?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/** Stores this session's replays and expires stale history from other sessions. */
export class ReplayHistoryStore {
  private readonly storage: ReplayStorage;
  private readonly sessionId: string;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private counter = 0;

  constructor(storage: ReplayStorage, options: HistoryOptions) {
    this.storage = storage; this.sessionId = options.sessionId;
    this.retentionMs = (options.retentionHours ?? HISTORY_RETENTION_HOURS) * 3_600_000;
    this.now = options.now ?? Date.now;
  }

  /** The app session this store saves into. */
  get currentSessionId(): string { return this.sessionId; }

  /** Refresh this session's activity timestamp. */
  async heartbeat(): Promise<void> { await this.storage.touchSession(this.sessionId, this.now()); }

  async save(replay: Replay): Promise<StoredReplay> {
    const savedAt = this.now();
    const { header } = replay;
    const record: StoredReplay = {
      id: `${savedAt}-${this.sessionId}-${this.counter++}`, sessionId: this.sessionId, savedAt,
      summary: {
        encounterId: header.encounterId, seed: header.seed, controlledPlayerId: header.controlledPlayerId, controlledPlayerName: header.controlledPlayerName,
        tickMs: header.tickMs, endTick: header.endTick, completed: header.result.completed, deathCount: header.result.deaths.length,
      },
      data: serializeReplay(replay),
    };
    await this.storage.putReplay(record);
    await this.heartbeat();
    return record;
  }

  /** Newest first. */
  async list(): Promise<StoredReplay[]> {
    return (await this.storage.listReplays()).sort((a, b) => b.savedAt - a.savedAt);
  }

  async load(id: string): Promise<Replay | undefined> {
    const record = await this.storage.getReplay(id);
    return record ? parseReplay(record.data) : undefined;
  }

  async remove(id: string): Promise<void> { await this.storage.deleteReplays([id]); }

  async clear(): Promise<void> { await this.storage.deleteReplays((await this.storage.listReplays()).map((record) => record.id)); }

  /** Deletes replays from earlier sessions that are older than the retention limit. Returns how many were removed. */
  async purge(): Promise<number> {
    const now = this.now();
    const activity = await this.storage.sessionActivity();
    const stale = (await this.storage.listReplays()).filter((record) => (
      record.sessionId !== this.sessionId
      && now - record.savedAt > this.retentionMs
      && now - (activity[record.sessionId] ?? 0) > SESSION_ACTIVE_WINDOW_MS
    ));
    await this.storage.deleteReplays(stale.map((record) => record.id));
    // Forget sessions that no longer own anything and have long been inactive.
    const remaining = new Set((await this.storage.listReplays()).map((record) => record.sessionId));
    const gone = Object.entries(activity).filter(([id, at]) => id !== this.sessionId && !remaining.has(id) && now - at > this.retentionMs).map(([id]) => id);
    if (gone.length) await this.storage.deleteSessions(gone);
    return stale.length;
  }
}
