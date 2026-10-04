import type { GameState } from '../simulation/GameState';
import type { Entity } from '../entities/Entity';
import type { StatusDefinition, StatusInstance } from '../entities/Status';
import type { EncounterResources } from '../encounters/Encounter';
import type { GraphicAnchor, WorldGraphicInstance } from '../mechanics/Graphic';
import type { MarkerDefinition } from '../encounters/Encounter';
import { statusDisplayName } from '../util/format';
import { DEFAULT_FACING } from '../geometry/Facing';
import type { Arena } from '../geometry/Arena';

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
  private shotcallVisible = true;
  private readonly shotcallElement: HTMLDivElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d')!;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'status-tooltip';
    document.body.append(this.tooltip);
    this.shotcallElement = document.createElement('div');
    this.shotcallElement.className = 'shotcall-display';
    this.shotcallElement.setAttribute('aria-live', 'polite');
    this.shotcallElement.hidden = true;
    canvas.parentElement?.insertBefore(this.shotcallElement, canvas);
    canvas.addEventListener('mousemove', (event) => this.updateTooltip(event));
    canvas.addEventListener('mouseleave', () => this.hideTooltip());
  }

  setShotcallVisible(visible: boolean): void { this.shotcallVisible = visible; }

  setStatusDefinitions(statuses: StatusDefinition[]): void {
    this.statusDefinitions.clear();
    for (const status of statuses) this.statusDefinitions.set(status.id, status);
  }

  /** Preloads resource-backed background/icon/graphic assets. */
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

  /** Returns the configured telegraph fill or the default solid fill. */
  private telegraphFillStyle(style: string | undefined, point: { x: number; y: number }, pixelRadius: number, color: string): string | CanvasGradient {
    if (style === 'soak') return this.buildSoakTelegraphGradient(point, pixelRadius, color);
    return hexToRgba(color, .28);
  }

  /** Builds the radial gradient used by soak telegraphs. */
  private buildSoakTelegraphGradient(point: { x: number; y: number }, pixelRadius: number, color: string): CanvasGradient {
    const gradient = this.context.createRadialGradient(point.x, point.y, 0, point.x, point.y, Math.max(pixelRadius, 1));
    const stop = (offset: number, alpha: number) => gradient.addColorStop(Math.min(1, Math.max(0, offset)), hexToRgba(color, alpha));
    stop(0, .85);
    stop(.18, 0);
    stop(.78, 0); // transparent in between
    stop(.98, .85); // short fade in to the outer ring
    stop(.99, .85); // bright ring
    stop(1, 0); // short fade out past the ring
    return gradient;
  }

  /** Converts mouse coordinates to world coordinates. */
  screenToWorld(event: MouseEvent): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / bounds.width;
    const scaleY = this.canvas.height / bounds.height;
    const canvasX = (event.clientX - bounds.left) * scaleX;
    const canvasY = (event.clientY - bounds.top) * scaleY;
    const scale = Math.min(this.canvas.width / 30, this.canvas.height / 20);
    return { x: (canvasX - this.canvas.width / 2) / scale, y: (canvasY - this.canvas.height / 2) / scale };
  }

  render(state: GameState): void {
    const { canvas, context } = this;
    const scale = Math.min(canvas.width / 30, canvas.height / 20);
    const toCanvas = (x: number, y: number) => ({ x: canvas.width / 2 + x * scale, y: canvas.height / 2 + y * scale });
    this.statusHitAreas = [];
    context.clearRect(0, 0, canvas.width, canvas.height);
    // Everything beyond the border is void: dark, hatched, and clearly not floor.
    this.drawVoid(state.arena, scale);
    // The floor (background, grid, markers, telegraphs) is clipped to the arena shape.
    context.save();
    this.traceArena(state.arena, toCanvas, scale);
    context.clip();
    const background = this.resolvedImage(state.background);
    if (background) context.drawImage(background, 0, 0, canvas.width, canvas.height);
    else { context.fillStyle = '#121821'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.strokeStyle = '#273443'; context.lineWidth = 1;
    for (let x = -15; x <= 15; x += 1) { const point = toCanvas(x, -10); context.beginPath(); context.moveTo(point.x, 0); context.lineTo(point.x, canvas.height); context.stroke(); }
    for (let y = -10; y <= 10; y += 1) { const point = toCanvas(-15, y); context.beginPath(); context.moveTo(0, point.y); context.lineTo(canvas.width, point.y); context.stroke(); }
    // Encounter markers sit above the arena background/grid but below telegraphs and units.
    for (const marker of state.markers) this.drawMarker(marker, scale, toCanvas);
    for (const effect of state.effects) {
      const point = toCanvas(effect.position.x, effect.position.y);
      const isTelegraph = effect.resolvedAt === undefined;
      const color = isTelegraph ? (effect.telegraphColor ?? DEFAULT_TELEGRAPH_COLOR) : (effect.executionColor ?? DEFAULT_EXECUTION_COLOR);
      context.fillStyle = isTelegraph ? this.telegraphFillStyle(effect.telegraphStyle, point, effect.radius * scale, color) : hexToRgba(color, .28);
      context.beginPath();
      if (effect.shape === 'circle') context.arc(point.x, point.y, effect.radius * scale, 0, Math.PI * 2);
      else if (effect.shape === 'donut') {
        context.arc(point.x, point.y, effect.radius * scale, 0, Math.PI * 2);
        context.moveTo(point.x + effect.innerRadius * scale, point.y);
        context.arc(point.x, point.y, effect.innerRadius * scale, 0, Math.PI * 2, true);
      } else if (effect.shape === 'half_room') {
        const left = toCanvas(-state.arena.halfWidth, 0).x;
        const right = toCanvas(state.arena.halfWidth, 0).x;
        const top = toCanvas(0, -state.arena.halfHeight).y;
        const bottom = toCanvas(0, state.arena.halfHeight).y;
        const split = point.y;
        if (effect.side === 'north') context.rect(left, top, right - left, split - top);
        else context.rect(left, split, right - left, bottom - split);
      } else { context.moveTo(point.x, point.y); context.arc(point.x, point.y, effect.radius * scale, effect.rotation - effect.angle * Math.PI / 360, effect.rotation + effect.angle * Math.PI / 360); context.closePath(); }
      context.fill();
    }
    context.restore();
    this.drawBorder(state.arena, toCanvas, scale);
    for (const enemy of state.enemies) this.drawUnit(enemy, '#ff7757', scale, toCanvas, true);
    for (const player of state.players) this.drawUnit(player, !player.alive ? DEAD_COLOR : player.controlled ? CONTROLLED_PLAYER_COLOR : PLAYER_COLOR, scale, toCanvas, false);
    for (const graphic of state.worldGraphics) this.drawWorldGraphic(graphic, state, scale, toCanvas);
    this.drawControlledStatuses(state, scale);
    this.updateShotcall(state);
  }

  private updateShotcall(state: GameState): void {
    const visible = this.shotcallVisible && state.shotcall !== undefined;
    this.shotcallElement.hidden = !visible;
    this.shotcallElement.textContent = visible ? state.shotcall!.text : '';
  }

  /** Traces the arena outline as the current path, in canvas pixels. */
  private traceArena(arena: Arena, toCanvas: (x: number, y: number) => { x: number; y: number }, scale: number): void {
    const centre = toCanvas(0, 0);
    this.context.beginPath();
    if (arena.shape === 'circle') this.context.arc(centre.x, centre.y, arena.radius * scale, 0, Math.PI * 2);
    else this.context.rect(centre.x - arena.halfWidth * scale, centre.y - arena.halfHeight * scale, arena.halfWidth * 2 * scale, arena.halfHeight * 2 * scale);
  }

  /** Fills the whole canvas with the dark hatched void that the arena floor is later drawn over. */
  private drawVoid(arena: Arena, scale: number): void {
    const { context, canvas } = this;
    const deadly = arena.edge === 'deadly';
    context.fillStyle = deadly ? '#0b0709' : '#07090d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.strokeStyle = deadly ? 'rgba(217, 87, 87, 0.16)' : 'rgba(120, 140, 160, 0.12)';
    context.lineWidth = 1;
    const spacing = Math.max(10, scale * 0.45);
    context.beginPath();
    for (let offset = -canvas.height; offset < canvas.width; offset += spacing) { context.moveTo(offset, canvas.height); context.lineTo(offset + canvas.height, 0); }
    context.stroke();
    context.restore();
  }

  /** Strokes the arena border: red and glowing when it kills, muted when it is only a wall. */
  private drawBorder(arena: Arena, toCanvas: (x: number, y: number) => { x: number; y: number }, scale: number): void {
    const { context } = this;
    const deadly = arena.edge === 'deadly';
    context.save();
    this.traceArena(arena, toCanvas, scale);
    context.lineJoin = 'round';
    if (deadly) { context.shadowColor = 'rgba(255, 70, 70, 0.85)'; context.shadowBlur = Math.max(8, scale * 0.35); }
    context.strokeStyle = deadly ? '#ff5252' : '#7d93a8';
    context.lineWidth = Math.max(2, scale * (deadly ? 0.1 : 0.07));
    context.stroke();
    context.restore();
  }

  private resolveAnchorPosition(anchor: GraphicAnchor, state: GameState): { x: number; y: number } | undefined {
    if (anchor.type === 'position') return anchor.position;
    const entity = [...state.players, ...state.enemies].find((candidate) => candidate.id === anchor.entity);
    return entity?.position;
  }

  private drawMarker(marker: MarkerDefinition & { resolvedPosition: { x: number; y: number } }, scale: number, toCanvas: (x: number, y: number) => { x: number; y: number }): void {
    const point = toCanvas(marker.resolvedPosition.x, marker.resolvedPosition.y);
    const radius = (marker.border?.radius ?? 0.55) * scale;
    const color = marker.color ?? '#dbe7f2';

    this.context.save();
    this.context.globalAlpha = 0.6;
    if (marker.border) {
      this.context.strokeStyle = marker.border.color ?? color;
      this.context.lineWidth = Math.max(1, scale * 0.045);
      this.context.beginPath();
      if (marker.border.shape === 'circle') {
        this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      } else {
        this.context.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
      }
      this.context.stroke();
    }

    const image = this.resolvedImage(marker.image);
    if (image) {
      this.context.drawImage(image, point.x - radius, point.y - radius, radius * 2, radius * 2);
    } else if (marker.character) {
      this.context.fillStyle = color;
      this.context.font = `600 ${Math.max(12, radius * 1.35)}px sans-serif`;
      this.context.textAlign = 'center';
      this.context.textBaseline = 'middle';
      this.context.fillText(marker.character, point.x, point.y);
    }
    this.context.restore();
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
    const point = toCanvas(entity.position.x, entity.position.y);
    const style = entity.style ?? { type: 'circle' };
    const radius = (style.type === 'ring' ? style.radius : style.radius ?? .38) * scale;
    // Dead units keep the dead color regardless of style.
    const fill = entity.alive ? (style.color ?? color) : color;
    this.context.beginPath();
    if (style.type === 'ring') {
      this.context.strokeStyle = fill;
      this.context.lineWidth = (style.thickness ?? .12) * scale;
      this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.context.stroke();
    } else if (style.type === 'circle') {
      this.context.fillStyle = fill;
      this.context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.context.fill();
    } else {
      this.tracePolygon(style.type, point, radius);
      this.context.fillStyle = fill;
      this.context.fill();
      this.context.strokeStyle = 'rgba(10, 15, 20, 0.7)';
      this.context.lineWidth = 2;
      this.context.stroke();
    }
    // Polygon markers are stationary objects and have no heading.
    if (style.type === 'circle' || style.type === 'ring') this.drawFacingWedge(entity, point, radius, scale);
    this.context.fillStyle = '#dbe7f2'; this.context.font = '12px sans-serif'; this.context.textAlign = 'center'; this.context.fillText(entity.name, point.x, point.y - radius - 8);
    if (showInlineStatuses) entity.statuses.filter((status) => !this.statusDefinitions.get(status.definitionId)?.hidden).forEach((status, index) => this.drawStatusIcon(status, point.x + radius + scale * (.24 + index * .48), point.y - radius * .5, scale));
  }

  /** Traces a closed marker outline; the triangle points up and the square is axis-aligned. */
  private tracePolygon(shape: 'diamond' | 'square' | 'triangle', point: { x: number; y: number }, radius: number): void {
    const offsets = shape === 'diamond'
      ? [[0, -1], [1, 0], [0, 1], [-1, 0]]
      : shape === 'square'
        ? [[-.8, -.8], [.8, -.8], [.8, .8], [-.8, .8]]
        : [[0, -1], [.87, .5], [-.87, .5]];
    offsets.forEach(([dx, dy], index) => {
      if (index === 0) this.context.moveTo(point.x + dx * radius, point.y + dy * radius);
      else this.context.lineTo(point.x + dx * radius, point.y + dy * radius);
    });
    this.context.closePath();
  }

  /** Draws a small wedge at the edge of a unit pointing in its current facing direction. */
  private drawFacingWedge(entity: Entity, point: { x: number; y: number }, radius: number, scale: number): void {
    const facing = entity.facing ?? DEFAULT_FACING;
    const radians = (facing * Math.PI) / 180;
    const dirX = Math.sin(radians);
    const dirY = -Math.cos(radians);
    const perpX = -dirY;
    const perpY = dirX;
    const tipDistance = radius + scale * 0.22;
    const baseDistance = Math.max(0, radius - scale * 0.03);
    const baseHalfWidth = scale * 0.12;
    const tip = { x: point.x + dirX * tipDistance, y: point.y + dirY * tipDistance };
    const baseLeft = { x: point.x + dirX * baseDistance + perpX * baseHalfWidth, y: point.y + dirY * baseDistance + perpY * baseHalfWidth };
    const baseRight = { x: point.x + dirX * baseDistance - perpX * baseHalfWidth, y: point.y + dirY * baseDistance - perpY * baseHalfWidth };
    this.context.beginPath();
    this.context.moveTo(tip.x, tip.y);
    this.context.lineTo(baseLeft.x, baseLeft.y);
    this.context.lineTo(baseRight.x, baseRight.y);
    this.context.closePath();
    this.context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.context.strokeStyle = 'rgba(10, 15, 20, 0.6)';
    this.context.lineWidth = 1;
    this.context.fill();
    this.context.stroke();
  }

  /** Renders the controlled player's statuses in a dedicated HUD row. */
  private drawControlledStatuses(state: GameState, scale: number): void {
    const controlled = state.players.find((player) => player.controlled);
    if (!controlled) return;
    const visibleStatuses = controlled.statuses.filter((status) => !this.statusDefinitions.get(status.definitionId)?.hidden);
    if (visibleStatuses.length === 0) return;
    const radius = Math.max(22, scale * .64);
    const gap = radius * 2.4;
    const fontSize = Math.max(14, radius * .7);
    const textGap = 4;
    const margin = 14;
    const y = this.canvas.height - margin - fontSize - textGap - radius;
    const baseX = this.canvas.width / 2 - ((visibleStatuses.length - 1) * gap) / 2;
    visibleStatuses.forEach((status, index) => {
      const x = baseX + index * gap;
      this.drawStatusIcon(status, x, y, scale, radius);
      const remaining = status.expiresAt === undefined ? '-' : String(Math.max(0, Math.ceil((status.expiresAt - state.time) / 1000)));
      this.context.fillStyle = '#dbe7f2';
      this.context.font = `500 ${fontSize}px 'DM Mono', monospace`;
      this.context.textAlign = 'center';
      this.context.textBaseline = 'middle';
      this.context.fillText(remaining, x, y + radius + textGap + fontSize / 2);
      this.context.textBaseline = 'alphabetic';
    });
  }

  private drawStatusIcon(status: StatusInstance, x: number, y: number, scale: number, radius = Math.max(7, scale * .2)): void {
    const definition = this.statusDefinitions.get(status.definitionId);
    const icon = this.resolvedImage(definition?.icon);
    if (icon) {
      // Preserve the source icon's silhouette and transparent padding.
      this.context.drawImage(icon, x - radius, y - radius, radius * 2, radius * 2);
    } else {
      const top = y - radius;
      const bottom = y + radius;
      const neck = y + radius * .05;
      const color = definition?.color ?? '#ffbe49';
      this.context.strokeStyle = color;
      this.context.lineWidth = Math.max(1.5, radius * .1);
      this.context.beginPath();
      this.context.moveTo(x - radius * .72, top);
      this.context.lineTo(x + radius * .72, top);
      this.context.lineTo(x + radius * .72, neck);
      this.context.lineTo(x, bottom);
      this.context.lineTo(x - radius * .72, neck);
      this.context.closePath();
      this.context.stroke();
      this.context.fillStyle = color;
      this.context.font = `500 ${Math.max(9, scale * .25)}px 'DM Mono', monospace`;
      this.context.textAlign = 'center';
      this.context.textBaseline = 'middle';
      this.context.fillText(definition?.character ?? '!', x, y - radius * .18);
      this.context.textBaseline = 'alphabetic';
    }
    if (definition?.showStacks) {
      const stackText = String(status.stacks);
      const stackFontSize = Math.max(15, radius * .95);
      const stackX = x + radius * .82;
      const stackY = y - radius * .78;
      this.context.font = `800 ${stackFontSize}px 'DM Mono', monospace`;
      this.context.textAlign = 'center';
      this.context.textBaseline = 'middle';
      this.context.lineJoin = 'round';
      this.context.miterLimit = 2;
      this.context.lineWidth = Math.max(3, stackFontSize * .24);
      this.context.strokeStyle = '#0a0f14';
      this.context.strokeText(stackText, stackX, stackY);
      this.context.fillStyle = '#ffffff';
      this.context.fillText(stackText, stackX, stackY);
      this.context.textBaseline = 'alphabetic';
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
    this.tooltip.textContent = statusDisplayName(hit.status.definitionId, this.statusDefinitions);
    this.tooltip.style.left = `${event.clientX + 12}px`;
    this.tooltip.style.top = `${event.clientY - 34}px`;
    this.tooltip.classList.add('visible');
  }

  private hideTooltip(): void { this.tooltip.classList.remove('visible'); }

}