import { runConditionLabels } from '../streak/RunConditions';
import { formatClock } from '../util/format';
import { HISTORY_RETENTION_HOURS } from './ReplayStore';
import type { ReplayHistoryStore, StoredReplay } from './ReplayStore';
import type { Replay } from './format';

export interface HistoryPanelHooks {
  store: ReplayHistoryStore;
  /** Display name for a timeline id. */
  encounterName(id: string): string;
  onWatch(replay: Replay): void;
  onSave(replay: Replay): void;
  /** Shown above the list, e.g. when browser storage is unavailable and history only lasts for this tab. */
  note?: string;
}

export interface HistoryPanel { open(): Promise<void>; close(): void; }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function resultText(record: StoredReplay): string {
  const { summary } = record;
  const deaths = summary.deathCount === 0 ? '' : ` · ${summary.deathCount} ${summary.deathCount === 1 ? 'death' : 'deaths'}`;
  const outcome = summary.completed ? 'Completed' : `${summary.failed ? 'Failed' : 'Abandoned'} at ${formatClock(summary.endTick * summary.tickMs)}`;
  return `${outcome}${deaths}`;
}

/** Dialog listing the replays kept in the history, newest first, with watch, save and delete for each. */
export function createHistoryPanel(hooks: HistoryPanelHooks): HistoryPanel {
  const dialog = el('dialog', 'history-dialog');
  const title = el('h2', undefined, 'Replay history');
  const note = el('p', 'history-note', `Every attempt from this session is kept here until you clear it. Replays from earlier sessions are removed after ${HISTORY_RETENTION_HOURS} hours.${hooks.note ? ` ${hooks.note}` : ''}`);
  const message = el('p', 'history-message'); message.hidden = true;
  const list = el('div', 'history-list');
  const footer = el('div', 'history-footer');
  const clear = el('button', undefined, 'Clear all');
  const close = el('button', undefined, 'Close');
  footer.append(clear, close);
  dialog.append(title, note, message, list, footer);
  document.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  let confirmClear = false;
  const say = (text: string) => { message.textContent = text; message.hidden = text === ''; };

  async function render(): Promise<void> {
    const records = await hooks.store.list();
    list.replaceChildren();
    clear.disabled = records.length === 0;
    clear.textContent = confirmClear ? 'Really clear all?' : 'Clear all';
    if (records.length === 0) { list.append(el('p', 'history-empty', 'No replays yet. Start an attempt and it will be recorded here.')); return; }
    const grid = el('table');
    const head = el('tr'); ['When', 'Timeline', 'Player', 'Result', 'Settings', 'Seed', ''].forEach((text) => head.append(el('th', undefined, text))); grid.append(head);
    for (const record of records) {
      const row = el('tr');
      const earlier = record.sessionId !== hooks.store.currentSessionId;
      const when = el('td', undefined, new Date(record.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      if (earlier) when.append(el('span', 'history-tag', ' earlier session'));
      const actions = el('td', 'history-actions');
      const watch = el('button', undefined, 'Watch'); const save = el('button', undefined, 'Save'); const remove = el('button', undefined, 'Delete');
      watch.addEventListener('click', async () => {
        try {
          const replay = await hooks.store.load(record.id);
          if (!replay) { say('That replay is no longer stored.'); await render(); return; }
          dialog.close(); hooks.onWatch(replay);
        } catch (error) { say(error instanceof Error ? error.message : 'That replay could not be opened.'); }
      });
      save.addEventListener('click', async () => {
        try { const replay = await hooks.store.load(record.id); if (replay) hooks.onSave(replay); } catch { say('That replay could not be saved.'); }
      });
      remove.addEventListener('click', async () => { await hooks.store.remove(record.id); say(''); await render(); });
      actions.append(watch, save, remove);
      row.append(when, el('td', undefined, hooks.encounterName(record.summary.encounterId)), el('td', undefined, record.summary.controlledPlayerName ?? record.summary.controlledPlayerId ?? 'All bots'), el('td', undefined, resultText(record)), el('td', undefined, record.summary.runFlags ? runConditionLabels(record.summary.runFlags).join(', ') : ''), el('td', undefined, String(record.summary.seed >>> 0)), actions);
      grid.append(row);
    }
    list.append(grid);
  }

  clear.addEventListener('click', async () => {
    if (!confirmClear) { confirmClear = true; await render(); return; }
    confirmClear = false; await hooks.store.clear(); say(''); await render();
  });
  dialog.addEventListener('close', () => { confirmClear = false; });

  return {
    async open() { confirmClear = false; say(''); try { await render(); } catch { say('The history could not be read.'); } if (!dialog.open) dialog.showModal(); },
    close() { dialog.close(); },
  };
}
