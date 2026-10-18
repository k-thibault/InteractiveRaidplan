import { ShotcallSpeaker } from './audio/ShotcallSpeaker';
import { runConditionLabels } from './streak/RunConditions';
import { setupMenus } from './ui/Menu';
import { ViewOptionsHold, type ViewOptions } from './ui/ViewOptions';
import { StreakTracker } from './streak/StreakTracker';
import type { RunFlags } from './streak/StreakTypes';
import './style.css';
import { loadEncounter, loadEncounterManifest, type EncounterManifestEntry } from './encounters/EncounterLoader';
import { PlayerController } from './input/PlayerController';
import { ArenaRenderer } from './rendering/ArenaRenderer';
import { Simulation } from './simulation/Simulation';
import { AttemptHistory } from './replay/AttemptHistory';
import { ReplayViewer } from './replay/ReplayViewer';
import { compatibilityWarnings, hashEncounter, recordSeedReplay } from './replay/playback';
import { downloadReplay, readReplayFile } from './replay/replayFiles';
import { createHistoryPanel } from './replay/HistoryPanel';
import { IndexedDbStorage } from './replay/IndexedDbStorage';
import { MemoryStorage, ReplayHistoryStore } from './replay/ReplayStore';
import type { ReplayStorage } from './replay/ReplayStore';
import { TICK_MS } from './replay/format';
import type { Replay } from './replay/format';
import { formatClock, statusDisplayName } from './util/format';
import type { StatusDefinition } from './entities/Status';
import type { Player } from './entities/Player';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="workbench"><header class="topbar"><div class="topbar__title"><h1 id="encounter-name">Loading encounter&hellip;</h1><div class="replay-meta" role="status"><span class="replay-meta__tag">Replay</span><span id="replay-info" class="replay-meta__info"></span><span id="replay-warning" class="replay-meta__warning" hidden></span></div></div><div class="topbar__pickers live-only"><div class="encounter-picker"><label for="encounter-select">Timeline</label><select id="encounter-select"></select></div><div class="encounter-picker"><label for="controlled-player">Control</label><select id="controlled-player"></select></div></div><div class="replay-seek"><span id="seek-time" class="replay-seek__time">00:00.0</span><input id="replay-seek" type="range" min="0" max="0" step="1" value="0" aria-label="Replay position"><span id="seek-end" class="replay-seek__time"></span></div><div class="replay-actions"><button id="replay-retry" type="button" title="Leave the replay and set up a new attempt with the same seed and random outcomes">Retry this RNG</button><button id="replay-exit" type="button">Exit replay</button></div><div class="readout live-only"><span id="phase">READY</span><strong id="clock">00:00.0</strong></div></header><section class="arena-row"><aside id="roster" class="roster-panel" aria-label="Party health"></aside><div class="arena-panel"><canvas id="arena" width="1200" height="800" aria-label="Encounter arena"></canvas><div id="cast-bars" class="cast-bars" aria-live="polite"></div><p class="arena-hint">Move with WASD or the arrow keys.</p><div id="streak" class="streak" role="status" hidden></div><span id="replay-notice" class="replay-notice" role="status"></span></div><aside class="event-log-panel"><h2>Event Log</h2><ul id="event-log"><li class="event-log__empty">No events yet.</li></ul></aside></section><footer class="controls"><div class="control-group"><button id="toggle" type="button">Start</button><button id="restart" type="button">Restart</button><div class="menu" data-menu><button id="replay-menu" class="menu__toggle" type="button">Replay</button><div class="menu__panel" role="menu" hidden><button id="watch-last" type="button" role="menuitem" data-menu-close disabled title="Watch your last attempt">Watch last attempt</button><button id="save-replay" type="button" role="menuitem" data-menu-close disabled title="Download this attempt as a replay file">Save replay</button><button id="load-replay" type="button" role="menuitem" data-menu-close title="Open a saved replay file">Load replay</button><button id="history-open" type="button" role="menuitem" data-menu-close title="Attempts from this session">History</button></div></div><div class="menu" data-menu><button id="run-options" class="menu__toggle" type="button">Run options</button><div class="menu__panel menu__panel--options" hidden><label class="live-only"><input id="keep-rng" type="checkbox"> Keep previous RNG</label>${import.meta.env.DEV ? '<label class="live-only"><input id="debug-mode" type="checkbox"> Debug log</label>' : ''}<div class="menu__row"><span>Shotcalls</span><label><input id="shotcall-text" type="checkbox" checked> Text</label><label><input id="shotcall-tts" type="checkbox" checked> TTS</label></div><label class="live-only"><input id="face-cursor" type="checkbox" checked> Face cursor when still</label><label><input id="hide-bots" type="checkbox"> Hide bots</label></div></div><input id="replay-file" type="file" accept=".json,application/json" hidden>${import.meta.env.DEV ? '<button id="batch-open" type="button">Batch simulate</button>' : ''}</div><div class="speed-group" role="group" aria-label="Simulation speed"><span>Speed</span><button data-speed="0.25" type="button">0.25x</button><button data-speed="0.5" type="button">0.5x</button><button class="selected" data-speed="1" type="button">1x</button><button class="replay-only" data-speed="2" type="button">2x</button><button class="replay-only" data-speed="4" type="button">4x</button></div></footer></main>`;
setupMenus();

const canvas = document.querySelector<HTMLCanvasElement>('#arena')!;
const renderer = new ArenaRenderer(canvas);
const phase = document.querySelector<HTMLSpanElement>('#phase')!;
const clock = document.querySelector<HTMLElement>('#clock')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const heading = document.querySelector<HTMLHeadingElement>('#encounter-name')!;
const roster = document.querySelector<HTMLDivElement>('#roster')!;
const castBars = document.querySelector<HTMLDivElement>('#cast-bars')!;
const castBarRows = new Map<string, { root: HTMLDivElement; name: HTMLSpanElement; fill: HTMLDivElement }>();
const logList = document.querySelector<HTMLUListElement>('#event-log')!;
const controlledPlayer = document.querySelector<HTMLSelectElement>('#controlled-player')!;
const faceCursor = document.querySelector<HTMLInputElement>('#face-cursor')!;
const hideBots = document.querySelector<HTMLInputElement>('#hide-bots')!;
const shotcallText = document.querySelector<HTMLInputElement>('#shotcall-text')!;
const shotcallTts = document.querySelector<HTMLInputElement>('#shotcall-tts')!;
const speaker = new ShotcallSpeaker();
const streakElement = document.querySelector<HTMLDivElement>('#streak')!;
const streak = new StreakTracker();
if (!speaker.supported) { shotcallTts.disabled = true; shotcallTts.title = 'Speech synthesis is not available in this browser'; }
speaker.setEnabled(shotcallTts.checked);
const encounterSelect = document.querySelector<HTMLSelectElement>('#encounter-select')!;
const keepRng = document.querySelector<HTMLInputElement>('#keep-rng')!;
const watchLast = document.querySelector<HTMLButtonElement>('#watch-last')!;
const saveReplay = document.querySelector<HTMLButtonElement>('#save-replay')!;
const loadReplay = document.querySelector<HTMLButtonElement>('#load-replay')!;
const replayFile = document.querySelector<HTMLInputElement>('#replay-file')!;
const replayNotice = document.querySelector<HTMLSpanElement>('#replay-notice')!;
const replayInfo = document.querySelector<HTMLSpanElement>('#replay-info')!;
const replayWarning = document.querySelector<HTMLSpanElement>('#replay-warning')!;
const replayRetry = document.querySelector<HTMLButtonElement>('#replay-retry')!;
const replayExit = document.querySelector<HTMLButtonElement>('#replay-exit')!;
const seekInput = document.querySelector<HTMLInputElement>('#replay-seek')!;
const seekTime = document.querySelector<HTMLSpanElement>('#seek-time')!;
const seekEnd = document.querySelector<HTMLSpanElement>('#seek-end')!;
const rosterTooltip = document.createElement('div');
rosterTooltip.className = 'status-tooltip';
document.body.append(rosterTooltip);

interface RosterRow { playerId: string; root: HTMLDivElement; fill: HTMLDivElement; value: HTMLSpanElement; statuses: HTMLDivElement; }
let rosterRows: RosterRow[] = [];
let encounter: Awaited<ReturnType<typeof loadEncounter>>;
let simulation: Simulation;
let controller: PlayerController | undefined;
let statusDefinitions = new Map<string, StatusDefinition>();
let imageResources: Record<string, string> = {};
let currentSeed = createAttemptSeed();
/** Replay cache for RNG outcomes while the seed remains fixed. */
let replayOutcomes = new Map<string, Record<string, unknown>>();
let speed = 1;
let previous = performance.now();
let accumulator = 0;
let loggedCount = 0;
/** Records every started attempt; the last one stays watchable until the next attempt begins ticking. */
/** The replay history (IndexedDB), ready before the first attempt can end. */
let historyStore: ReplayHistoryStore | undefined;
const history = new AttemptHistory((replay) => { historyStore?.save(replay).catch(() => setReplayNotice('This attempt could not be added to the replay history.')); });
/** Set while a replay is being watched; the page then shows the viewer's simulation instead of a live one. */
let viewer: ReplayViewer | undefined;
let currentEntryId = '';
let savedControlled: string | undefined;
const viewOptionsHold = new ViewOptionsHold();
let hashedEncounter: { encounter: object; hash: number } | undefined;

function createAttemptSeed(): number {
  if (globalThis.crypto?.getRandomValues) { const value = new Uint32Array(1); globalThis.crypto.getRandomValues(value); return value[0] | 0; }
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) | 0;
}

function buildRoster(players: Player[]): void {
  roster.replaceChildren();
  const ordered = [...players].sort((a, b) => Number(b.controlled) - Number(a.controlled));
  rosterRows = ordered.map((player) => {
    const root = document.createElement('div'); root.className = 'roster-entry'; root.classList.toggle('roster-entry--controlled', player.controlled);
    const statuses = document.createElement('div'); statuses.className = 'roster-entry__statuses';
    const main = document.createElement('div'); main.className = 'roster-entry__main';
    const header = document.createElement('div'); header.className = 'roster-entry__header';
    const name = document.createElement('span'); name.textContent = player.name;
    const value = document.createElement('span'); value.className = 'roster-entry__value'; header.append(name, value);
    const track = document.createElement('div'); track.className = 'roster-entry__track';
    const fill = document.createElement('div'); fill.className = 'roster-entry__fill'; track.append(fill); main.append(header, track); root.append(statuses, main); roster.append(root);
    return { playerId: player.id, root, fill, value, statuses };
  });
}

function updateRoster(players: Player[], now: number): void {
  for (const row of rosterRows) {
    const player = players.find((candidate) => candidate.id === row.playerId); if (!player) continue;
    const max = player.maxHealth ?? player.health; const pct = max > 0 ? Math.max(0, Math.min(100, (player.health / max) * 100)) : 0;
    row.fill.style.width = `${pct}%`; row.fill.classList.toggle('roster-entry__fill--low', pct <= 50 && pct > 20); row.fill.classList.toggle('roster-entry__fill--critical', pct <= 20);
    row.value.textContent = player.alive ? `${Math.ceil(player.health)} / ${max}` : 'Defeated'; row.root.classList.toggle('roster-entry--dead', !player.alive);
    row.statuses.replaceChildren();
    for (const status of player.statuses) {
      const definition = statusDefinitions.get(status.definitionId); if (definition?.hidden) continue;
      const badge = document.createElement('div');
      badge.className = 'roster-status';
      badge.addEventListener('mouseenter', (event) => {
        rosterTooltip.textContent = statusDisplayName(status.definitionId, statusDefinitions);
        rosterTooltip.style.left = `${event.clientX + 12}px`;
        rosterTooltip.style.top = `${event.clientY - 34}px`;
        rosterTooltip.classList.add('visible');
      });
      badge.addEventListener('mousemove', (event) => {
        rosterTooltip.style.left = `${event.clientX + 12}px`;
        rosterTooltip.style.top = `${event.clientY - 34}px`;
      });
      badge.addEventListener('mouseleave', () => {
        rosterTooltip.classList.remove('visible');
      });

      const icon = document.createElement('div'); icon.className = 'roster-status__icon'; const iconUrl = definition?.icon ? imageResources[definition.icon] : undefined;
      if (iconUrl) {
        icon.style.backgroundImage = `url("${iconUrl}")`;
      } else {
        icon.classList.add('roster-status__icon--default');
        icon.style.setProperty('--status-color', definition?.color ?? '#ffbe49');
        icon.textContent = definition?.character ?? '!';
      }
      if (definition?.showStacks) {
        const stack = document.createElement('span');
        stack.className = 'roster-status__stack';
        stack.textContent = String(status.stacks);
        icon.append(stack);
      }
      badge.append(icon); const timer = document.createElement('span'); timer.className = 'roster-status__timer'; timer.textContent = status.expiresAt === undefined ? '-' : String(Math.max(0, Math.ceil((status.expiresAt - now) / 1000))); badge.append(timer); row.statuses.append(badge);
    }
  }
}

function resetLog(): void {
  loggedCount = 0; logList.replaceChildren(); const empty = document.createElement('li'); empty.className = 'event-log__empty'; empty.textContent = 'No events yet.'; logList.append(empty);
}

function rebuild(): void {
  if (!encounter) return;
  history.abandon();
  if (!document.querySelector<HTMLInputElement>('#keep-rng')!.checked) { currentSeed = createAttemptSeed(); replayOutcomes = new Map(); }
  // Debug logging is available only in development.
  const debug = document.querySelector<HTMLInputElement>('#debug-mode')?.checked ?? false;
  simulation = new Simulation(encounter, { seed: currentSeed, controlledPlayerId: controlledPlayer.value || undefined, replayOutcomes, debug });
  controller?.dispose();
  controller = new PlayerController(simulation.state.players.find((player) => player.controlled), simulation.state.arena);
  controller.setFaceCursorWhenStill(faceCursor.checked); simulation.setDriver(controller);
  // Hiding bots only makes sense while a specific player is controlled.
  hideBots.disabled = !controlledPlayer.value; hideBots.title = hideBots.disabled ? 'Select a player to control to hide the bots' : '';
  // Ignore RNG replays; capture hidden-bot state at run setup.
  streak.beginRun(currentRunFlags(), !document.querySelector<HTMLInputElement>('#keep-rng')!.checked); renderStreak();
  speaker.reset(); buildRoster(simulation.state.players); accumulator = 0; previous = performance.now(); toggle.textContent = 'Start'; phase.textContent = 'READY'; resetLog();
  castBars.replaceChildren(); castBarRows.clear();
}

async function selectEncounter(entry: EncounterManifestEntry, requestedPlayer?: string | null): Promise<void> {
  encounter = await loadEncounter(entry.file); currentEntryId = entry.id;
  streak.reset();
  heading.textContent = encounter.name;
  renderer.setStatusDefinitions(encounter.statuses); renderer.setResources(encounter.resources); renderer.setShotcallVisible(shotcallText.checked); statusDefinitions = new Map(encounter.statuses.map((status) => [status.id, status])); imageResources = encounter.resources?.images ?? {};
  controlledPlayer.replaceChildren();
  for (const player of encounter.players) { const option = document.createElement('option'); option.value = player.id; option.textContent = player.name; controlledPlayer.append(option); }
  const botsOption = document.createElement('option'); botsOption.value = ''; botsOption.textContent = 'All bots'; controlledPlayer.append(botsOption);
  // Default to All bots; `?player=<id or name>` opens the page controlling that player instead.
  const wanted = requestedPlayer?.trim().toLowerCase();
  const requested = wanted ? encounter.players.find((player) => player.id.toLowerCase() === wanted || player.name.toLowerCase() === wanted) : undefined;
  controlledPlayer.value = requested?.id ?? '';
  rebuild();
}

// Production builds list only encounters marked prod-ready.
const manifest = (await loadEncounterManifest()).filter((entry) => import.meta.env.DEV || entry.prodready === true);
for (const entry of manifest) { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name; option.dataset.file = entry.file; encounterSelect.append(option); }
encounterSelect.addEventListener('change', async () => { encounterSelect.blur(); streak.reset(); renderStreak(); const entry = manifest.find((candidate) => candidate.id === encounterSelect.value); if (entry) await selectEncounter(entry); });
// Blur so a focused dropdown does not swallow the arrow keys (they would change the controlled player mid-run).
controlledPlayer.addEventListener('change', () => { controlledPlayer.blur(); rebuild(); });
faceCursor.addEventListener('change', () => controller?.setFaceCursorWhenStill(faceCursor.checked));
shotcallText.addEventListener('change', () => { renderer.setShotcallVisible(shotcallText.checked); syncStreakFlags(); });
hideBots.addEventListener('change', () => { renderer.setHideBots(hideBots.checked); syncStreakFlags(); });
// Arrow keys move the player, so they must never scroll the page. Dropdowns and text fields keep their own arrow-key behaviour.
window.addEventListener('keydown', (event) => {
  if (!event.key.startsWith('Arrow')) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('dialog') || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'checkbox'))) return;
  event.preventDefault();
});
shotcallTts.addEventListener('change', () => { speaker.setEnabled(shotcallTts.checked); syncStreakFlags(); });
canvas.addEventListener('mousemove', (event) => controller?.setMouseWorldPosition(renderer.screenToWorld(event)));
toggle.addEventListener('click', () => { if (viewer) { toggleReplayPlayback(); return; } if (simulation.state.running) { simulation.pause(); streak.pause(); speaker.pause(); toggle.textContent = 'Resume'; } else { if (simulation.state.time === 0 && streak.startRun(controlledPlayer.value)) renderStreak(); beginRecording(); simulation.start(); speaker.resume(); toggle.textContent = 'Pause'; } });
document.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', () => { if (viewer) restartReplay(); else rebuild(); });
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => button.addEventListener('click', () => { speed = Number(button.dataset.speed); document.querySelector('.selected')?.classList.remove('selected'); button.classList.add('selected'); }));

// Replay history: one id per page load. Replays from earlier loads are purged once they are old enough.
const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let historyNote: string | undefined;
{
  let storage: ReplayStorage;
  // A blocked or hung database must not keep the page from loading, so give it two seconds.
  try { storage = await Promise.race([IndexedDbStorage.open(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('IndexedDB timed out')), 2000))]); } catch { storage = new MemoryStorage(); historyNote = 'Browser storage is unavailable, so the history only lasts until this tab is closed.'; }
  historyStore = new ReplayHistoryStore(storage, { sessionId });
  await historyStore.heartbeat().catch(() => undefined);
  await historyStore.purge().catch(() => undefined);
  setInterval(() => { historyStore?.heartbeat().catch(() => undefined); }, 60_000);
}

// Preselect `?encounter=<id>`; unknown or unavailable ids fall back to the first entry.
const urlParams = new URLSearchParams(window.location.search);
const requestedId = urlParams.get('encounter');
const initialEntry = manifest.find((entry) => entry.id === requestedId) ?? manifest[0];
if (initialEntry) { encounterSelect.value = initialEntry.id; await selectEncounter(initialEntry, urlParams.get('player')); }
else heading.textContent = 'No encounters available';

// Development builds only: the batch simulation dialog is not part of the production bundle.
if (import.meta.env.DEV) {
  const { createBatchPanel } = await import('./dev/BatchPanel');
  const batchPanel = createBatchPanel({
    getEncounter: () => encounter,
    onReplay: (seed) => { void enterReplay(recordSeedReplay(encounter, currentEntryId, seed)); },
  });
  document.querySelector<HTMLButtonElement>('#batch-open')!.addEventListener('click', () => batchPanel.open());
}

function entityName(id: string): string | undefined {
  return simulation.state.players.find((player) => player.id === id)?.name ?? simulation.state.enemies.find((enemy) => enemy.id === id)?.name;
}

function renderHud(): void {
  const visibleCasts = simulation.state.casts.filter((active) => encounter.casts?.[active.definitionId]?.visible !== false);
  const activeIds = new Set(visibleCasts.map((active) => active.id));
  for (const [id, row] of castBarRows) { if (!activeIds.has(id)) { row.root.remove(); castBarRows.delete(id); } }
  for (const cast of visibleCasts) {
    let row = castBarRows.get(cast.id);
    if (!row) {
      const root = document.createElement('div'); root.className = 'cast-bar cast-bar--visible';
      const name = document.createElement('span'); name.className = 'cast-bar__name';
      const track = document.createElement('div'); track.className = 'cast-bar__track';
      const fill = document.createElement('div'); fill.className = 'cast-bar__fill';
      track.append(fill); root.append(name, track); castBars.append(root);
      row = { root, name, fill }; castBarRows.set(cast.id, row);
    }
    const definition = encounter.casts?.[cast.definitionId];
    const duration = Math.max(1, cast.completesAt - cast.startedAt);
    const source = entityName(cast.sourceId);
    row.name.textContent = source ? `${definition?.name ?? cast.definitionId} — ${source}` : (definition?.name ?? cast.definitionId);
    row.fill.style.width = `${Math.max(0, Math.min(100, ((simulation.state.time - cast.startedAt) / duration) * 100))}%`;
  }
  updateRoster(simulation.state.players, simulation.state.time);
  const entries = simulation.state.log; if (loggedCount === 0 && entries.length > 0) logList.replaceChildren();
  for (; loggedCount < entries.length; loggedCount++) { const entry = entries[loggedCount]; const item = document.createElement('li'); if (entry.channel === 'debug') item.classList.add('event-log__entry--debug'); const time = document.createElement('span'); time.className = 'event-log__time'; time.textContent = formatClock(entry.time); item.append(time, document.createTextNode(entry.message)); logList.prepend(item); }}

/** Return the current streak eligibility flags. */
function currentRunFlags(): RunFlags {
  return {
    botsHidden: hideBots.checked && !hideBots.disabled,
    shotcallsOff: !shotcallText.checked && !(shotcallTts.checked && !shotcallTts.disabled),
  };
}

/** Sync settings; active runs can only lose eligibility. */
function syncStreakFlags(): void { if (viewer) return; streak.setFlags(currentRunFlags(), simulation.state.time > 0); }

/** Render every non-redundant streak, strongest first. */
function renderStreak(): void {
  const rows = streak.view();
  streakElement.hidden = rows.length === 0;
  streakElement.replaceChildren();
  for (const row of rows) {
    const line = document.createElement('span'); line.className = 'streak__row'; line.dataset.streak = row.id; line.title = row.label;
    line.style.setProperty('--streak-color', row.style.color); line.style.setProperty('--streak-intensity', String(row.style.intensity));
    const count = document.createElement('b'); count.textContent = String(row.count);
    line.append(row.label,' streak ', count); streakElement.append(line);
  }
}

/** Resolve the controlled run as failed or successful once. */
function evaluateRun(): void {
  if (viewer || !simulation || streak.resolved || !controlledPlayer.value) return;
  const state = simulation.state;
  const failStatuses = encounter.failStatuses ?? [];
  const failed = state.players.some((player) => !player.alive || player.statuses.some((status) => failStatuses.includes(status.definitionId)));
  if (failed) { if (streak.fail()) renderStreak(); return; }
  if (state.completed && streak.succeed()) renderStreak();
}


// ---------------------------------------------------------------------------------------------------------------------------------
// Replays: always-on recording of live attempts, and a separate viewer mode for watching them.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Called when an attempt is started; the recorder wraps the live driver so it sees exactly what the simulation saw. */
function beginRecording(): void {
  if (history.recording || simulation.tickCount > 0) return;
  if (hashedEncounter?.encounter !== encounter) hashedEncounter = { encounter, hash: hashEncounter(encounter) };
  history.begin(simulation, controller, {
    encounterId: currentEntryId, encounterHash: hashedEncounter.hash, seed: currentSeed, outcomes: replayOutcomes, tickMs: TICK_MS, runFlags: () => streak.flags,
    warn: import.meta.env.DEV ? (message) => console.warn(message) : undefined,
  });
}

/** Speeds above 1x exist only in replay mode, so leaving it puts the speed back to 1x. */
function selectSpeed(value: number): void {
  speed = value;
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => button.classList.toggle('selected', Number(button.dataset.speed) === value));
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
/** Shown as a toast over the arena (so it never changes the page height) and cleared after a few seconds. */
function setReplayNotice(message: string): void {
  replayNotice.textContent = message; clearTimeout(noticeTimer);
  if (message) noticeTimer = setTimeout(() => { replayNotice.textContent = ''; }, 8000);
}

/** Swap the arena, roster and log over to another simulation. */
function showSimulation(next: Simulation): void {
  simulation = next; speaker.reset(); buildRoster(next.state.players); accumulator = 0; previous = performance.now(); resetLog();
  castBars.replaceChildren(); castBarRows.clear();
}

/** Replay mode keeps view options (hide bots, shotcalls, speed) and turns off everything that changes the run itself. */
function showViewOptions(options: ViewOptions): void {
  shotcallText.checked = options.shotcallText; shotcallTts.checked = options.shotcallTts; hideBots.checked = options.hideBots;
  renderer.setShotcallVisible(shotcallText.checked); speaker.setEnabled(shotcallTts.checked); renderer.setHideBots(hideBots.checked);
}

function setReplayModeControls(active: boolean): void {
  document.body.classList.toggle('replay-mode', active);
  if (!active) selectSpeed(1);
  for (const control of [controlledPlayer, keepRng, faceCursor, encounterSelect]) control.disabled = active;
  hideBots.disabled = active ? !viewer?.replay.header.controlledPlayerId : !controlledPlayer.value;
  hideBots.title = hideBots.disabled ? 'Select a player to control to hide the bots' : '';
}

async function enterReplay(replay: Replay): Promise<void> {
  const entry = manifest.find((candidate) => candidate.id === replay.header.encounterId);
  if (!entry) { setReplayNotice(`That replay is for "${replay.header.encounterId}", which is not available here.`); return; }
  setReplayNotice('');
  if (!viewer) savedControlled = controlledPlayer.value;
  showViewOptions(viewOptionsHold.hold({ shotcallText: shotcallText.checked, shotcallTts: shotcallTts.checked, hideBots: hideBots.checked }));
  viewer = undefined;
  history.abandon();
  if (entry.id !== currentEntryId) { encounterSelect.value = entry.id; await selectEncounter(entry, replay.header.controlledPlayerId ?? ''); }
  viewer = new ReplayViewer(encounter, replay, compatibilityWarnings(replay, encounter, entry.id));
  controller?.dispose(); controller = undefined;
  controlledPlayer.value = replay.header.controlledPlayerId ?? '';
  setReplayModeControls(true);
  showSimulation(viewer.simulation); shownEpoch = viewer.epoch;
  seekInput.max = String(viewer.endTick); seekInput.value = '0'; seekEnd.textContent = formatClock(viewer.endTick * viewer.replay.header.tickMs);
  toggle.textContent = 'Pause'; phase.textContent = 'REPLAY'; lastBannerText = '';
}

function restartReplay(): void {
  if (!viewer) return;
  viewer.restart(); toggle.textContent = 'Pause'; lastBannerText = '';
}

function toggleReplayPlayback(): void {
  if (!viewer) return;
  if (viewer.finished) { restartReplay(); return; }
  viewer.playing = !viewer.playing;
  if (viewer.playing) speaker.resume(); else speaker.pause();
}

function exitReplay(): void {
  if (!viewer) return;
  viewer = undefined;
  renderer.setHideControlledFacing(false);
  if (savedControlled !== undefined) controlledPlayer.value = savedControlled;
  const liveOptions = viewOptionsHold.release(); if (liveOptions) showViewOptions(liveOptions);
  setReplayModeControls(false);
  rebuild();
}

/**
 * Leave the replay and set up a fresh attempt with the replay's seed and every random outcome it resolved, controlling the same
 * player (or all bots for an all-bots replay), exactly as if "Keep previous RNG" had been on after that attempt. Press Start to begin.
 */
function retryReplayRng(): void {
  if (!viewer) return;
  const { header } = viewer.replay;
  replayOutcomes = viewer.retryOutcomes(); currentSeed = header.seed;
  keepRng.checked = true; savedControlled = header.controlledPlayerId ?? '';
  exitReplay();
}

let lastBannerText = '';
/** The viewer simulation epoch the page currently shows; a change means the simulation was replaced (restart or rewind). */
let shownEpoch = 0;
let seekDragging = false;
/** Per-frame replay UI: banner text, play button label, and the enabled state of the watch/save buttons. */
function updateReplayUi(): void {
  if (viewer) {
    const { header } = viewer.replay;
    const player = simulation.state.players.find((candidate) => candidate.controlled)?.name ?? 'All bots';
    const diverged = viewer.divergedAtMs;
    const warnings = [...viewer.warnings];
    if (diverged !== undefined) warnings.push(`Replay diverged at ${formatClock(diverged)}: what is shown from there on may not match the original attempt.`);
    // The clock and the end of the replay live on the seek bar in the header, so the info line stays short and static.
    const conditions = header.runFlags ? runConditionLabels(header.runFlags) : [];
    const info = [player, `seed ${header.seed >>> 0}`, ...(header.result.completed ? [] : [header.result.failed ? 'failed' : 'abandoned']), ...conditions].join(' · ');
    const text = `${info}|${warnings.join(' ')}`;
    if (text !== lastBannerText) {
      lastBannerText = text; replayInfo.textContent = info;
      const warning = warnings.join(' ');
      replayWarning.hidden = warnings.length === 0; replayWarning.textContent = warning ? `⚠ ${warning}` : ''; replayWarning.title = warning;
    }
    if (!seekDragging && !viewer.seeking) seekInput.value = String(viewer.tick);
    seekTime.textContent = formatClock(viewer.tick * header.tickMs);
    const label = viewer.finished ? 'Watch again' : viewer.playing ? 'Pause' : 'Play';
    if (toggle.textContent !== label) toggle.textContent = label;
    phase.textContent = viewer.finished ? 'REPLAY ENDED' : 'REPLAY';
  }
  watchLast.disabled = viewer !== undefined || history.available === undefined;
  saveReplay.disabled = viewer === undefined && history.available === undefined;
}

watchLast.addEventListener('click', () => { const replay = history.available; if (replay) void enterReplay(replay); });
saveReplay.addEventListener('click', () => { const replay = viewer?.replay ?? history.available; if (replay) downloadReplay(replay); });
loadReplay.addEventListener('click', () => replayFile.click());
replayFile.addEventListener('change', async () => {
  const file = replayFile.files?.[0]; replayFile.value = ''; if (!file) return;
  try { await enterReplay(await readReplayFile(file)); } catch (error) { setReplayNotice(error instanceof Error ? error.message : 'That file could not be read as a replay.'); }
});
// Dragging seeks live without pausing: playback carries on from wherever the handle is released.
seekInput.addEventListener('input', () => viewer?.seekTo(Number(seekInput.value)));
seekInput.addEventListener('pointerdown', () => { seekDragging = true; });
for (const type of ['pointerup', 'pointercancel', 'blur']) seekInput.addEventListener(type, () => { seekDragging = false; });
replayExit.addEventListener('click', exitReplay);
const historyPanel = createHistoryPanel({
  store: historyStore!, note: historyNote,
  encounterName: (id) => manifest.find((entry) => entry.id === id)?.name ?? id,
  onWatch: (replay) => { void enterReplay(replay); },
  onSave: downloadReplay,
});
document.querySelector<HTMLButtonElement>('#history-open')!.addEventListener('click', () => {
  // The simulation keeps running behind a modal dialog, so stop whatever is playing first.
  if (viewer) viewer.playing = false;
  else if (simulation?.state.running) { simulation.pause(); streak.pause(); speaker.pause(); toggle.textContent = 'Resume'; }
  void historyPanel.open();
});
replayRetry.addEventListener('click', retryReplayRng);

function frame(now: number): void {
  const elapsed = Math.min(now - previous, 100); previous = now;
  // The controlled player moves inside the fixed step (the simulation's driver), so live play and replay share one movement path.
  if (viewer) viewer.update(elapsed, speed);
  else {
    accumulator += elapsed * speed;
    while (accumulator >= TICK_MS) { if (simulation?.state.running) { simulation.tick(TICK_MS); evaluateRun(); } else simulation?.idleTick(TICK_MS); accumulator -= TICK_MS; }
    history.settle();
  }
  // A rewind or restart builds a new simulation; the roster, log and cast bars derived from the old one start over.
  if (viewer && viewer.epoch !== shownEpoch) { shownEpoch = viewer.epoch; showSimulation(viewer.simulation); }
  // Speech stays silent while scrubbing or faster than 1x; calls that pass meanwhile are not read late.
  speaker.setMuted(viewer !== undefined && (viewer.seeking || speed > 1));
  // Inside a recorded span the controlled player's facing was not recorded, so the arrow would be a guess.
  renderer.setHideControlledFacing(viewer?.driver !== undefined && !viewer.driver.facingTracked);
  if (simulation) { renderer.render(simulation.state); speaker.update(simulation.state.shotcall); renderHud(); clock.textContent = formatClock(simulation.state.time); const controlled = simulation.state.players.find((player) => player.controlled); if (simulation.state.failed) phase.textContent = 'WIPED'; else if (simulation.state.completed) phase.textContent = 'COMPLETE'; else if (controlled && !controlled.alive) phase.textContent = 'DEFEATED'; else if (simulation.state.running) phase.textContent = 'RUNNING'; }
  updateReplayUi();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
