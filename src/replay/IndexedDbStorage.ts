import type { ReplayStorage, StoredReplay } from './ReplayStore';

const DATABASE = 'raidplan-replays';
const REPLAYS = 'replays';
const SESSIONS = 'sessions';

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { source.onsuccess = () => resolve(source.result); source.onerror = () => reject(source.error); });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
}

/** IndexedDB-backed replay storage. */
export class IndexedDbStorage implements ReplayStorage {
  private readonly database: IDBDatabase;
  private constructor(database: IDBDatabase) { this.database = database; }

  static async open(): Promise<IndexedDbStorage> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(REPLAYS, { keyPath: 'id' });
      opening.result.createObjectStore(SESSIONS, { keyPath: 'sessionId' });
    };
    return new IndexedDbStorage(await request(opening));
  }

  private async run<T>(store: string, mode: IDBTransactionMode, work: (objectStore: IDBObjectStore) => IDBRequest<T> | undefined): Promise<T | undefined> {
    const transaction = this.database.transaction(store, mode);
    const pending = work(transaction.objectStore(store));
    const [result] = await Promise.all([pending ? request(pending) : Promise.resolve(undefined), finished(transaction)]);
    return result as T | undefined;
  }

  async putReplay(record: StoredReplay): Promise<void> { await this.run(REPLAYS, 'readwrite', (store) => store.put(record)); }
  async listReplays(): Promise<StoredReplay[]> { return (await this.run(REPLAYS, 'readonly', (store) => store.getAll())) ?? []; }
  async getReplay(id: string): Promise<StoredReplay | undefined> { return this.run(REPLAYS, 'readonly', (store) => store.get(id)); }
  async deleteReplays(ids: string[]): Promise<void> { await this.run(REPLAYS, 'readwrite', (store) => { ids.forEach((id) => store.delete(id)); return undefined; }); }
  async touchSession(sessionId: string, at: number): Promise<void> { await this.run(SESSIONS, 'readwrite', (store) => store.put({ sessionId, lastActive: at })); }
  async sessionActivity(): Promise<Record<string, number>> {
    const rows = (await this.run<Array<{ sessionId: string; lastActive: number }>>(SESSIONS, 'readonly', (store) => store.getAll())) ?? [];
    return Object.fromEntries(rows.map((row) => [row.sessionId, row.lastActive]));
  }
  async deleteSessions(ids: string[]): Promise<void> { await this.run(SESSIONS, 'readwrite', (store) => { ids.forEach((id) => store.delete(id)); return undefined; }); }
}
