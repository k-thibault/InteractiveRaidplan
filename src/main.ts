import './style.css';
import { loadEncounter, loadEncounterManifest, type EncounterManifestEntry } from './encounters/EncounterLoader';
import { PlayerController } from './input/PlayerController';
import { ArenaRenderer } from './rendering/ArenaRenderer';
import { Simulation } from './simulation/Simulation';
import { formatClock, formatStatusName } from './util/format';
import type { StatusDefinition } from './entities/Status';
import type { Player } from './entities/Player';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="workbench"><header class="topbar"><div><p class="eyebrow">ENCOUNTER LAB / TIMELINES</p><h1 id="encounter-name">Loading encounter&hellip;</h1></div><div class="encounter-picker"><label for="encounter-select">Timeline</label><select id="encounter-select"></select></div><div class="readout"><span id="phase">READY</span><strong id="clock">00:00.0</strong></div></header><section class="arena-row"><aside id="roster" class="roster-panel" aria-label="Party health"></aside><div class="arena-panel"><canvas id="arena" width="1200" height="800" aria-label="Encounter arena"></canvas><div id="cast-bars" class="cast-bars" aria-live="polite"></div></div><aside class="event-log-panel"><h2>Event Log</h2><ul id="event-log"><li class="event-log__empty">No events yet.</li></ul></aside></section><footer class="controls"><div class="control-group"><button id="toggle" type="button">Start</button><button id="restart" type="button">Restart</button><label><input id="keep-rng" type="checkbox"> Keep previous RNG</label><label for="controlled-player">Control</label><select id="controlled-player"></select></div><div class="speed-group" role="group" aria-label="Simulation speed"><span>Speed</span><button data-speed="0.5" type="button">0.5x</button><button class="selected" data-speed="1" type="button">1x</button><button data-speed="2" type="button">2x</button><button data-speed="4" type="button">4x</button></div><p class="hint">Move with WASD or the arrow keys.</p></footer></main>`;

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
const encounterSelect = document.querySelector<HTMLSelectElement>('#encounter-select')!;
const rosterTooltip = document.createElement('div');
rosterTooltip.className = 'status-tooltip';
document.body.append(rosterTooltip);

interface RosterRow { playerId: string; root: HTMLDivElement; fill: HTMLDivElement; value: HTMLSpanElement; statuses: HTMLDivElement; }
let rosterRows: RosterRow[] = [];
let encounter: Awaited<ReturnType<typeof loadEncounter>>;
let simulation: Simulation;
let controller: PlayerController;
let statusDefinitions = new Map<string, StatusDefinition>();
let imageResources: Record<string, string> = {};
let currentSeed = createAttemptSeed();
/** Replay cache for RNG outcomes while the seed remains fixed. */
let replayOutcomes = new Map<string, Record<string, unknown>>();
let speed = 1;
let previous = performance.now();
let accumulator = 0;
let loggedCount = 0;

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
        rosterTooltip.textContent = formatStatusName(status.definitionId);
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
      if (status.stacks > 1) {
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
  if (!document.querySelector<HTMLInputElement>('#keep-rng')!.checked) { currentSeed = createAttemptSeed(); replayOutcomes = new Map(); }
  simulation = new Simulation(encounter, { seed: currentSeed, controlledPlayerId: controlledPlayer.value || undefined, replayOutcomes });
  controller = new PlayerController(simulation.state.players.find((player) => player.controlled));
  buildRoster(simulation.state.players); accumulator = 0; previous = performance.now(); toggle.textContent = 'Start'; phase.textContent = 'READY'; resetLog();
  castBars.replaceChildren(); castBarRows.clear();
}

async function selectEncounter(entry: EncounterManifestEntry): Promise<void> {
  encounter = await loadEncounter(entry.file);
  heading.textContent = encounter.name;
  renderer.setStatusDefinitions(encounter.statuses); renderer.setResources(encounter.resources); statusDefinitions = new Map(encounter.statuses.map((status) => [status.id, status])); imageResources = encounter.resources?.images ?? {};
  controlledPlayer.replaceChildren();
  for (const player of encounter.players) { const option = document.createElement('option'); option.value = player.id; option.textContent = player.name; controlledPlayer.append(option); }
  const botsOption = document.createElement('option'); botsOption.value = ''; botsOption.textContent = 'All bots'; controlledPlayer.append(botsOption);
  controlledPlayer.value = encounter.players.find((player) => player.id === 'player')?.id ?? encounter.players[0]?.id ?? '';
  rebuild();
}

const manifest = await loadEncounterManifest();
for (const entry of manifest) { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name; option.dataset.file = entry.file; encounterSelect.append(option); }
encounterSelect.addEventListener('change', async () => { const entry = manifest.find((candidate) => candidate.id === encounterSelect.value); if (entry) await selectEncounter(entry); });
controlledPlayer.addEventListener('change', rebuild);
toggle.addEventListener('click', () => { if (simulation.state.running) { simulation.pause(); toggle.textContent = 'Resume'; } else { simulation.start(); toggle.textContent = 'Pause'; } });
document.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', rebuild);
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => button.addEventListener('click', () => { speed = Number(button.dataset.speed); document.querySelector('.selected')?.classList.remove('selected'); button.classList.add('selected'); }));

await selectEncounter(manifest[0]);

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
  for (; loggedCount < entries.length; loggedCount++) { const entry = entries[loggedCount]; const item = document.createElement('li'); const time = document.createElement('span'); time.className = 'event-log__time'; time.textContent = formatClock(entry.time); item.append(time, document.createTextNode(entry.message)); logList.prepend(item); }
}

function frame(now: number): void {
  const elapsed = Math.min(now - previous, 100); previous = now; controller?.update(elapsed / 1000 * speed); accumulator += elapsed * speed;
  while (accumulator >= 1000 / 60) { simulation?.tick(1000 / 60); accumulator -= 1000 / 60; }
  if (simulation) { renderer.render(simulation.state); renderHud(); clock.textContent = formatClock(simulation.state.time); const controlled = simulation.state.players.find((player) => player.controlled); if (simulation.state.completed) phase.textContent = 'COMPLETE'; else if (controlled && !controlled.alive) phase.textContent = 'DEFEATED'; else if (simulation.state.running) phase.textContent = 'RUNNING'; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
