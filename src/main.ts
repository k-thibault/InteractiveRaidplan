import './style.css';
import { loadEncounter } from './encounters/EncounterLoader';
import { PlayerController } from './input/PlayerController';
import { ArenaRenderer } from './rendering/ArenaRenderer';
import { Simulation } from './simulation/Simulation';
import { formatClock } from './util/format';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="workbench"><header class="topbar"><div><p class="eyebrow">ENCOUNTER LAB / 001</p><h1 id="encounter-name">Loading encounter&hellip;</h1></div><div class="readout"><span id="phase">READY</span><strong id="clock">00:00.0</strong></div></header><section class="arena-row"><div class="arena-panel"><canvas id="arena" width="900" height="600" aria-label="Encounter arena"></canvas><div class="legend"><span><i class="dot player"></i>players</span><span><i class="dot enemy"></i>boss</span><span><i class="dot warning"></i>telegraph</span></div><div id="cast-bar" class="cast-bar" aria-live="polite"><span id="cast-name" class="cast-bar__name"></span><div class="cast-bar__track"><div id="cast-fill" class="cast-bar__fill"></div></div></div><div id="hp-bar" class="hp-bar" role="meter" aria-label="Player health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span id="hp-name" class="hp-bar__name"></span><div class="hp-bar__track"><div id="hp-fill" class="hp-bar__fill"></div></div><span id="hp-value" class="hp-bar__value"></span></div></div><aside class="event-log-panel"><h2>Event Log</h2><ul id="event-log"><li class="event-log__empty">No events yet.</li></ul></aside></section><footer class="controls"><div class="control-group"><button id="toggle" type="button">Start</button><button id="restart" type="button">Restart</button><label><input id="keep-rng" type="checkbox"> Keep previous RNG</label><label for="controlled-player">Control</label><select id="controlled-player"></select></div><div class="speed-group" role="group" aria-label="Simulation speed"><span>Speed</span><button data-speed="0.5" type="button">0.5x</button><button class="selected" data-speed="1" type="button">1x</button><button data-speed="2" type="button">2x</button><button data-speed="4" type="button">4x</button></div><p class="hint">Move with WASD or the arrow keys.</p></footer></main>`;

const canvas = document.querySelector<HTMLCanvasElement>('#arena')!;
const renderer = new ArenaRenderer(canvas);
const phase = document.querySelector<HTMLSpanElement>('#phase')!;
const clock = document.querySelector<HTMLElement>('#clock')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const heading = document.querySelector<HTMLHeadingElement>('#encounter-name')!;
const hpBar = document.querySelector<HTMLDivElement>('#hp-bar')!;
const hpName = document.querySelector<HTMLSpanElement>('#hp-name')!;
const hpFill = document.querySelector<HTMLDivElement>('#hp-fill')!;
const hpValue = document.querySelector<HTMLSpanElement>('#hp-value')!;
const castBar = document.querySelector<HTMLDivElement>('#cast-bar')!;
const castName = document.querySelector<HTMLSpanElement>('#cast-name')!;
const castFill = document.querySelector<HTMLDivElement>('#cast-fill')!;
const logList = document.querySelector<HTMLUListElement>('#event-log')!;
const controlledPlayer = document.querySelector<HTMLSelectElement>('#controlled-player')!;
const encounter = await loadEncounter('/encounters/example.json');
heading.textContent = encounter.name;
renderer.setStatusDefinitions(encounter.statuses);
for (const player of encounter.players) { const option = document.createElement('option'); option.value = player.id; option.textContent = player.name; controlledPlayer.append(option); }
const botsOption = document.createElement('option'); botsOption.value = ''; botsOption.textContent = 'All bots'; controlledPlayer.append(botsOption);
controlledPlayer.value = 'player';
let currentSeed = createAttemptSeed();
let simulation = new Simulation(encounter, { seed: currentSeed, controlledPlayerId: controlledPlayer.value });
let controller = new PlayerController(simulation.state.players.find((player) => player.controlled)!);
let speed = 1;
let previous = performance.now();
let accumulator = 0;
let loggedCount = 0;

function createAttemptSeed(): number {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] | 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) | 0;
}

function rebuild(): void {
  const keepRng = document.querySelector<HTMLInputElement>('#keep-rng')!.checked;
  if (!keepRng) currentSeed = createAttemptSeed();
  simulation = new Simulation(encounter, { seed: currentSeed, controlledPlayerId: controlledPlayer.value || undefined });
  controller = new PlayerController(simulation.state.players.find((player) => player.controlled)!);
  accumulator = 0;
  previous = performance.now();
  toggle.textContent = 'Start';
  phase.textContent = 'READY';
  loggedCount = 0;
  logList.replaceChildren();
  const empty = document.createElement('li');
  empty.className = 'event-log__empty';
  empty.textContent = 'No events yet.';
  logList.append(empty);
}
toggle.addEventListener('click', () => { if (simulation.state.running) { simulation.pause(); toggle.textContent = 'Resume'; } else { simulation.start(); toggle.textContent = 'Pause'; } });
document.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', rebuild);
controlledPlayer.addEventListener('change', rebuild);
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => button.addEventListener('click', () => { speed = Number(button.dataset.speed); document.querySelector('.selected')?.classList.remove('selected'); button.classList.add('selected'); }));

function renderHud(): void {
  const cast = simulation.state.casts.find((active) => encounter.casts?.[active.definitionId]?.visible !== false);
  if (cast) {
    const definition = encounter.casts?.[cast.definitionId];
    const duration = Math.max(1, cast.completesAt - cast.startedAt);
    castName.textContent = definition?.name ?? cast.definitionId;
    castFill.style.width = `${Math.max(0, Math.min(100, ((simulation.state.time - cast.startedAt) / duration) * 100))}%`;
    castBar.classList.add('cast-bar--visible');
  } else {
    castBar.classList.remove('cast-bar--visible');
    castFill.style.width = '0%';
  }
  const player = simulation.state.players.find((candidate) => candidate.controlled);
  if (player) {
    const max = player.maxHealth ?? player.health;
    const pct = max > 0 ? Math.max(0, Math.min(100, (player.health / max) * 100)) : 0;
    hpName.textContent = player.name;
    hpFill.style.width = `${pct}%`;
    hpFill.classList.toggle('hp-bar__fill--low', pct <= 50 && pct > 20);
    hpFill.classList.toggle('hp-bar__fill--critical', pct <= 20);
    hpValue.textContent = player.alive ? `${Math.ceil(player.health)} / ${max}` : 'Defeated';
    hpBar.setAttribute('aria-valuenow', String(Math.round(player.health)));
    hpBar.setAttribute('aria-valuemax', String(max));
  } else {
    hpName.textContent = 'All bots';
    hpFill.style.width = '0%';
    hpFill.classList.remove('hp-bar__fill--low', 'hp-bar__fill--critical');
    hpValue.textContent = 'No player selected';
    hpBar.setAttribute('aria-valuenow', '0');
  }
  const entries = simulation.state.log;
  if (loggedCount === 0 && entries.length > 0) logList.replaceChildren();
  for (; loggedCount < entries.length; loggedCount++) {
    const entry = entries[loggedCount];
    const item = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'event-log__time';
    time.textContent = formatClock(entry.time);
    item.append(time, document.createTextNode(entry.message));
    logList.prepend(item);
  }
}

function frame(now: number): void {
  const elapsed = Math.min(now - previous, 100); previous = now;
  controller.update(elapsed / 1000 * speed);
  accumulator += elapsed * speed;
  while (accumulator >= 1000 / 60) { simulation.tick(1000 / 60); accumulator -= 1000 / 60; }
  renderer.render(simulation.state);
  renderHud();
  clock.textContent = formatClock(simulation.state.time);
  const controlled = simulation.state.players.find((player) => player.controlled);
  if (simulation.state.completed) phase.textContent = 'COMPLETE'; else if (controlled && !controlled.alive) phase.textContent = 'DEFEATED'; else if (simulation.state.running) phase.textContent = 'RUNNING';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);