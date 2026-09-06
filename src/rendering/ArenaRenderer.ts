import type { GameState } from '../simulation/GameState';
import type { Entity } from '../entities/Entity';
import type { StatusInstance } from '../entities/Status';
import { formatStatusName } from '../util/format';

interface StatusHitArea {
  x: number;
  y: number;
  status: StatusInstance;
}

export class ArenaRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly tooltip: HTMLDivElement;
  private statusHitAreas: StatusHitArea[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d')!;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'status-tooltip';
    document.body.append(this.tooltip);
    canvas.addEventListener('mousemove', (event) => this.updateTooltip(event));
    canvas.addEventListener('mouseleave', () => this.hideTooltip());
  }

  render(state: GameState): void {
    const { canvas, context } = this;
    const scale = Math.min(canvas.width / 30, canvas.height / 20);
    const toCanvas = (x: number, y: number) => ({ x: canvas.width / 2 + x * scale, y: canvas.height / 2 + y * scale });
    this.statusHitAreas = [];
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#121821'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#273443'; context.lineWidth = 1;
    for (let x = -14; x <= 14; x += 1) { const point = toCanvas(x, -9); context.beginPath(); context.moveTo(point.x, 0); context.lineTo(point.x, canvas.height); context.stroke(); }
    for (let y = -9; y <= 9; y += 1) { const point = toCanvas(-14, y); context.beginPath(); context.moveTo(0, point.y); context.lineTo(canvas.width, point.y); context.stroke(); }
    for (const effect of state.effects) {
      const point = toCanvas(effect.position.x, effect.position.y); context.fillStyle = effect.shape === 'cone' ? 'rgba(255, 119, 87, .28)' : 'rgba(255, 190, 73, .28)';
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
    for (const enemy of state.enemies) this.drawUnit(enemy, '#ff7757', scale, toCanvas);
    for (const player of state.players) this.drawUnit(player, player.alive ? '#74d4a0' : '#68727d', scale, toCanvas);
  }

  private drawUnit(entity: Entity & { statuses: StatusInstance[] }, color: string, scale: number, toCanvas: (x: number, y: number) => { x: number; y: number }): void {
    const point = toCanvas(entity.position.x, entity.position.y); this.context.fillStyle = color; this.context.beginPath(); this.context.arc(point.x, point.y, scale * .38, 0, Math.PI * 2); this.context.fill();
    this.context.fillStyle = '#dbe7f2'; this.context.font = '12px sans-serif'; this.context.textAlign = 'center'; this.context.fillText(entity.name, point.x, point.y - scale * .6);
    entity.statuses.forEach((status, index) => this.drawStatusIcon(status, point.x + scale * (.62 + index * .48), point.y - scale * .38, scale));
  }

  private drawStatusIcon(status: StatusInstance, x: number, y: number, scale: number): void {
    const radius = Math.max(7, scale * .2);
    this.context.fillStyle = '#ffbe49'; this.context.beginPath(); this.context.arc(x, y, radius, 0, Math.PI * 2); this.context.fill();
    this.context.fillStyle = '#18232e'; this.context.font = `500 ${Math.max(9, scale * .25)}px 'DM Mono', monospace`; this.context.textAlign = 'center'; this.context.textBaseline = 'middle'; this.context.fillText('!', x, y + 1); this.context.textBaseline = 'alphabetic';
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