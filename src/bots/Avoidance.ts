import { BOT_DEADLY_EDGE_INSET, clampToArena } from '../geometry/Arena';
import type { Arena } from '../geometry/Arena';
import { distance, normalize } from '../geometry/Vector2';
import type { Vector2 } from '../geometry/Vector2';

export interface Obstacle { position: Vector2; radius: number; }

/** Waypoints per obstacle. */
const RING_POINTS = 12;
/** Waypoint distance beyond the obstacle. */
const CLEARANCE = 0.1;
/** Tolerance for paths grazing an obstacle. */
const GRAZE = 1e-6;

interface Graph { nodes: Vector2[]; links: number[][]; }
const graphs = new Map<string, Graph>();
const MAX_CACHED_GRAPHS = 16;

/** Distance from `point` to the segment `from`-`to`. */
function distanceToSegment(point: Vector2, from: Vector2, to: Vector2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}

function segmentClear(from: Vector2, to: Vector2, obstacles: readonly Obstacle[]): boolean {
  return obstacles.every((obstacle) => distanceToSegment(obstacle.position, from, to) >= obstacle.radius - GRAZE);
}

/** Arena bounds are convex, so a segment stays inside when both its ends do. */
function insideArena(point: Vector2, arena: Arena | undefined): boolean {
  if (!arena) return true;
  const inset = { x: point.x, y: point.y };
  clampToArena(inset, arena, arena.edge === 'deadly' ? BOT_DEADLY_EDGE_INSET : 0);
  return Math.abs(inset.x - point.x) < 1e-9 && Math.abs(inset.y - point.y) < 1e-9;
}

/** Builds a visibility graph around obstacles. */
function buildGraph(obstacles: readonly Obstacle[], arena: Arena | undefined): Graph {
  const nodes: Vector2[] = [];
  for (const obstacle of obstacles) {
    const ring = (obstacle.radius + CLEARANCE) / Math.cos(Math.PI / RING_POINTS);
    for (let index = 0; index < RING_POINTS; index += 1) {
      const angle = (index / RING_POINTS) * Math.PI * 2;
      const point = { x: obstacle.position.x + Math.cos(angle) * ring, y: obstacle.position.y + Math.sin(angle) * ring };
      const buried = obstacles.some((other) => distance(point, other.position) < other.radius + CLEARANCE / 2);
      if (!buried && insideArena(point, arena)) nodes.push(point);
    }
  }
  const links: number[][] = nodes.map(() => []);
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      if (!segmentClear(nodes[a], nodes[b], obstacles)) continue;
      links[a].push(b);
      links[b].push(a);
    }
  }
  return { nodes, links };
}

function graphFor(obstacles: readonly Obstacle[], arena: Arena | undefined): Graph {
  const arenaKey = arena ? `${arena.shape}:${arena.halfWidth}:${arena.halfHeight}:${arena.edge}` : 'open';
  const key = `${arenaKey}|${obstacles.map((o) => `${o.position.x.toFixed(3)},${o.position.y.toFixed(3)},${o.radius}`).join(';')}`;
  let graph = graphs.get(key);
  if (!graph) {
    graph = buildGraph(obstacles, arena);
    if (graphs.size >= MAX_CACHED_GRAPHS) graphs.delete(graphs.keys().next().value as string);
    graphs.set(key, graph);
  }
  return graph;
}

/** Finds the first waypoint toward the shortest reachable route. */
function shortestFirstStep(from: Vector2, to: Vector2, graph: Graph, obstacles: readonly Obstacle[]): Vector2 | undefined {
  const { nodes, links } = graph;
  const cost = nodes.map(() => Infinity);
  const previous = nodes.map(() => -1);
  const done = nodes.map(() => false);
  nodes.forEach((node, index) => { if (segmentClear(from, node, obstacles)) cost[index] = distance(from, node); });
  const goalLinks = nodes.map((node) => segmentClear(node, to, obstacles));

  let best = Infinity;
  let bestNode = -1;
  for (;;) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) if (!done[index] && cost[index] < Infinity && (current === -1 || cost[index] < cost[current])) current = index;
    if (current === -1 || cost[current] >= best) break;
    done[current] = true;
    const total = cost[current] + distance(nodes[current], to);
    if (goalLinks[current] && total < best) { best = total; bestNode = current; }
    for (const next of links[current]) {
      const through = cost[current] + distance(nodes[current], nodes[next]);
      if (through < cost[next]) { cost[next] = through; previous[next] = current; }
    }
  }

  if (bestNode === -1) {
    let nearest = -1;
    for (let index = 0; index < nodes.length; index += 1) if (cost[index] < Infinity && (nearest === -1 || distance(nodes[index], to) < distance(nodes[nearest], to))) nearest = index;
    if (nearest === -1) return undefined;
    bestNode = nearest;
  }
  let step = bestNode;
  while (previous[step] !== -1) step = previous[step];
  return nodes[step];
}

/** Finds the next safe waypoint toward the destination. */
export function routeAround(from: Vector2, to: Vector2, obstacles: readonly Obstacle[], arena?: Arena): Vector2 {
  // Leaving an obstacle comes first: walk straight out of it.
  for (const obstacle of obstacles) {
    const away = distance(from, obstacle.position);
    if (away < obstacle.radius) {
      const out = away === 0 ? { x: 1, y: 0 } : normalize({ x: from.x - obstacle.position.x, y: from.y - obstacle.position.y });
      return { x: obstacle.position.x + out.x * (obstacle.radius + 0.1), y: obstacle.position.y + out.y * (obstacle.radius + 0.1) };
    }
  }
  // Ignore obstacles containing the destination.
  const reachable = obstacles.filter((obstacle) => distance(to, obstacle.position) >= obstacle.radius);
  if (segmentClear(from, to, reachable)) return to;
  return shortestFirstStep(from, to, graphFor(reachable, arena), reachable) ?? to;
}

/** Pushes a point out of any obstacle containing it. */
export function outsideObstacles(point: Vector2, obstacles: readonly Obstacle[]): Vector2 {
  let result = { x: point.x, y: point.y };
  for (let pass = 0; pass < obstacles.length; pass += 1) {
    const inside = obstacles.find((obstacle) => distance(result, obstacle.position) < obstacle.radius);
    if (!inside) break;
    const out = distance(result, inside.position) === 0 ? { x: 1, y: 0 } : normalize({ x: result.x - inside.position.x, y: result.y - inside.position.y });
    result = { x: inside.position.x + out.x * (inside.radius + CLEARANCE), y: inside.position.y + out.y * (inside.radius + CLEARANCE) };
  }
  return result;
}
