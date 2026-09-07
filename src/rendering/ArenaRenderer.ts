import type { GameState } from '../simulation/GameState';
import type { Entity } from '../entities/Entity';
import type { StatusDefinition, StatusInstance } from '../entities/Status';
import type { EncounterResources } from '../encounters/Encounter';
import type { GraphicAnchor, WorldGraphicInstance } from '../mechanics/Graphic';
import { formatStatusName } from '../util/format';

interface StatusHitArea {
  x: number;
  y: number;
  status: StatusInstance;
}

const DEFAULT_TELEGRAPH_COLOR = '#ffbe49';
const DEFAULT_EXECUTION_COLOR = '#d95757';
const CONTROLLED_PLAYER_COLOR = '#4da6ff';
const PLAYER_COLOR = '#74d4a0';
const DEAD_COLOR = '#68727d';

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class ArenaRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly tooltip: HTMLDivElement;
  private statusHitAreas: StatusHitArea[] = [];
  private readonly statusDefinitions = new Map<string, StatusDefinition>();
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d')!;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'status-tooltip';
    document.body.append(this.tooltip);
    canvas.addEventListener('mousemove', (event) => this.updateTooltip(event));
    canvas.addEventListener('mouseleave', () => this.hideTooltip());
  }

  setStatusDefinitions(statuses: StatusDefinition[]): void {
    this.statusDefinitions.clear();
    for (const status of statuses) this.statusDefinitions.set(status.id, status);
  }

  /** Preloads the encounter's resource-based graphics (arena backgrounds, status icons, world graphics). Images that are still loading, missing, or fail simply fall back to the built-in shapes/colors. */
  setResources(resources: EncounterResources | undefined): void {
    this.images.clear();
    for (const [key, src] of Object.entries(resources?.images ?? {})) {
      const image = new Image();
      image.src = src;
      this.images.set(key, image);
    }
  }

  private resolvedImage(key: string | undefined): HTMLImageElement | undefined {
    if (!key) return undefined;
    const image = this.images.get(key);
    return image && image.complete && image.naturalWidth > 0 ? image : undefined;
  }

  render(state: GameState): void {
    const { canvas, context } = this;
    const scale = Math.min(canvas.width / 30, canvas.height / 20);
    const toCanvas = (x: number, y: number) => ({ x: canvas.width / 2 + x * scale, y: canvas.height / 2 + y * scale });
    this.statusHitAreas = [];
    context.clearRect(0, 0, canvas.width, canvas.height);
    const background = this.resolvedImage(state.background);
    if (background) context.drawImage(background, 0, 0, canvas.width, canvas.height);
    else { context.fillStyle = '#121821'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.strokeStyle = '#273443'; context.lineWidth = 1;
    for (let x = -14; x <= 14; x += 1) { const point = toCanvas(x, -9); context.beginPath(); context.moveTo(point.x, 0); context.lineTo(point.x, canvas.height); context.stroke(); }
    for (let y = -9; y <= 9; y += 1) { const point = toCanvas(-14, y); context.beginPath(); context.moveTo(0, point.y); context.lineTo(canvas.width, point.y); context.stroke(); }
    for (const effect of state.effects) {
      const point = toCanvas(effect.position.x, effect.position.y);
      const color = effect.resolvedAt === undefined ? (effect.telegraphColor ?? DEFAULT_TELEGRAPH_COLOR) : (effect.executionColor ?? DEFAULT_EXECUTION_COLOR);
      context.fillStyle = hexToRgba(color, .28);
      context.beginPath();
      if (effect.shape === 'circle') context.arc(point.x, point.y, effect.radius * scale, 0, Math.PI * 2);
      else if (effect.shape === 'half_room') {
        const left = toCanvas(-14, 0).x;
        const right = toCanvas(14, 0).x;
        const top = toCanvas(0, -9).y;
        const bottom = toCanvas(0, 9).y;
        const split = point.y;
        if (effect.side === 'north') context.rect(left, top, right - left, split - top);
        else context.rect(left, split, right - left, bottom - split);
      } else { context.moveTo(point.x, point.y); context.arc(point.x, point.y, effect.radius * scale, effect.rotation - effect.angle * Math.PI / 360, effect.rotation + effect.angle * Math.PI / 360); context.closePath(); }
      context.fill();
    }
    for (const enemy of state.enemies) this.drawUnit(enemy, '#ff7757', scale, toCanvas, true);
    for (const player of state.players) this.drawUnit(player, !player.alive ? DEAD_COLOR : player.controlled ? CONTROLLED_PLAYER_COLOR : PLAYER_COLOR, scale, toCanvas, false);
    for (const graphic of state.worldGraphics) this.drawWorldGraphic(graphic, state, scale, toCanvas);
    this.drawControlledStatuses(state, scale);
  }

  private resolveAnchorPosition(anchor: GraphicAnchor, state: GameState): { x: number; y: number } | undefined {
    if (anchor.type === 'position') return anchor.position;
    const entity = [...state.players, ...state.enemies].find((candidate) => candidate.id === anchor.entity);
    return entity?.position;
  }

  private drawWorldGraphic(graphic: WorldGraphicInstance, state: GameState, scale: number, toCanvas: (x: number, y: number) => { x: number; y: number }): void {
    const worldPosition = this.resolveAnchorPosition(graphic.anchor, state);
    if (!worldPosition) return;
    const point = toCanvas(worldPosition.x, worldPosition.y);
    const size = graphic.radius * scale;
    const elapsed = state.time - graphic.createdAt;
    const remaining = graphic.duration - elapsed;
    const fade = remaining < 400 ? Math.max(0, remaining / 400) : 1;
    const image = this.resolvedImage(graphic.image);
    this.context.save();
    this.context.globalAlpha = fade;
    if (image) {
      this.context.drawImage(image, point.x - size, point.y - size, size * 2, size * 2);
    } else {
      this.context.strokeStyle = '#ffbe49';
      this.context.lineWidth = 2;
      this.context.beginPath();
      this.context.arc(point.x, point.y, size, 0, Math.PI * 2);
      this.context.stroke();
    }
    this.context.restore();
  }

  private drawUnit(entity: Entity & { statuses: StatusInstance[] }, color: string, scale: number, toCanvas: (x: number, y: number) => { x: number; y: number }, showInlineStatuses: boolean): void {
    const point = toCanvas(entity.position.x, entity.position.y); this.context.fillStyle = color; this.context.beginPath(); this.context.arc(point.x, point.y, scale * .38, 0, Math.PI * 2); this.context.fill();
    this.context.fillStyle = '#dbe7f2'; this.context.font = '12px sans-serif'; this.context.textAlign = 'center'; this.context.fillText(entity.name, point.x, point.y - scale * .6);
    if (showInlineStatuses) entity.statuses.forEach((status, index) => this.drawStatusIcon(status, point.x + scale * (.62 + index * .48), point.y - scale * .38, scale));
  }

  /** The controlled player's statuses get a dedicated, larger display bottom-center instead of crowding their on-field icon. */
  private drawControlledStatuses(state: GameState, scale: number): void {
    const controlled = state.players.find((player) => player.controlled);
    if (!controlled || controlled.statuses.length === 0) return;
    const radius = Math.max(11, scale * .32);
    const gap = radius * 2.4;
    const baseX = this.canvas.width / 2 - ((controlled.statuses.length - 1) * gap) / 2;
    const y = this.canvas.height - radius - 14;
    controlled.statuses.forEach((status, index) => this.drawStatusIcon(status, baseX + index * gap, y, scale, radius));
  }

  private drawStatusIcon(status: StatusInstance, x: number, y: number, scale: number, radius = Math.max(7, scale * .2)): void {
    const definition = this.statusDefinitions.get(status.definitionId);
    const icon = this.resolvedImage(definition?.icon);
    if (icon) {
      this.context.save();
      this.context.beginPath();
      this.context.arc(x, y, radius, 0, Math.PI * 2);
      this.context.clip();
      this.context.drawImage(icon, x - radius, y - radius, radius * 2, radius * 2);
      this.context.restore();
    } else {
      this.context.fillStyle = definition?.color ?? '#ffbe49'; this.context.beginPath(); this.context.arc(x, y, radius, 0, Math.PI * 2); this.context.fill();
      this.context.fillStyle = '#18232e'; this.context.font = `500 ${Math.max(9, scale * .25)}px 'DM Mono', monospace`; this.context.textAlign = 'center'; this.context.textBaseline = 'middle'; this.context.fillText(definition?.character ?? '!', x, y + 1); this.context.textBaseline = 'alphabetic';
    }
    this.statusHitAreas.push({ x, y, status });
  }

  private updateTooltip(event: MouseEvent): void {
    const bounds = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / bounds.width;
    const scaleY = this.canvas.height / bounds.height;
    const x = (event.clientX - bounds.left) * scaleX;
    const y = (event.clientY - bounds.top) * scaleY;
    const hit = this.statusHitAreas.find((area) => Math.hypot(area.x - x, area.y - y) <= 14);
    if (!hit) { this.hideTooltip(); return; }
    this.tooltip.textContent = formatStatusName(hit.status.definitionId);
    this.tooltip.style.left = `${event.clientX + 12}px`;
    this.tooltip.style.top = `${event.clientY - 34}px`;
    this.tooltip.classList.add('visible');
  }

  private hideTooltip(): void { this.tooltip.classList.remove('visible'); }

}