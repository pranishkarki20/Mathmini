import { nodeIds, type NodeId, type Road } from '../data/network';

export type DijkstraStep = { current: NodeId; visited: NodeId[]; distances: Record<NodeId, number>; relaxed: string[] };
export type PathResult = { path: NodeId[]; distance: number; steps: DijkstraStep[]; distances: Record<NodeId, number> };
export type TreeStep = { edge: Road; accepted: boolean; reason: string };
export type TreeResult = { edges: Road[]; steps: TreeStep[]; total: number; complete: boolean };

const adjacency = (roads: Road[]) => {
  const graph = Object.fromEntries(nodeIds.map((id) => [id, [] as { to: NodeId; road: Road }[]])) as Record<NodeId, { to: NodeId; road: Road }[]>;
  roads.filter((road) => road.open).forEach((road) => {
    graph[road.a].push({ to: road.b, road });
    graph[road.b].push({ to: road.a, road });
  });
  return graph;
};

export function dijkstra(roads: Road[], start: NodeId, end: NodeId): PathResult {
  const graph = adjacency(roads);
  const distances = Object.fromEntries(nodeIds.map((id) => [id, Infinity])) as Record<NodeId, number>;
  const previous: Partial<Record<NodeId, NodeId>> = {};
  const visited = new Set<NodeId>();
  const steps: DijkstraStep[] = [];
  distances[start] = 0;
  while (visited.size < nodeIds.length) {
    const current = nodeIds.filter((id) => !visited.has(id)).reduce<NodeId | null>((best, id) => best === null || distances[id] < distances[best] ? id : best, null);
    if (current === null || !Number.isFinite(distances[current])) break;
    visited.add(current);
    const relaxed: string[] = [];
    for (const { to, road } of graph[current]) {
      if (visited.has(to)) continue;
      const candidate = distances[current] + road.minutes;
      if (candidate < distances[to]) { distances[to] = candidate; previous[to] = current; relaxed.push(road.id); }
    }
    steps.push({ current, visited: [...visited], distances: { ...distances }, relaxed });
    if (current === end) break;
  }
  const path: NodeId[] = [];
  if (Number.isFinite(distances[end])) {
    for (let cursor: NodeId | undefined = end; cursor; cursor = previous[cursor]) { path.unshift(cursor); if (cursor === start) break; }
    if (path[0] !== start) path.length = 0;
  }
  return { path, distance: path.length ? distances[end] : Infinity, steps, distances };
}

export function breadthFirstPath(roads: Road[], start: NodeId, end: NodeId): NodeId[] {
  const graph = adjacency(roads);
  const queue = [start];
  const previous: Partial<Record<NodeId, NodeId | null>> = { [start]: null };
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === end) break;
    for (const { to } of graph[current]) if (!(to in previous)) { previous[to] = current; queue.push(to); }
  }
  if (!(end in previous)) return [];
  const path: NodeId[] = [];
  for (let cursor: NodeId | null | undefined = end; cursor; cursor = previous[cursor]) path.unshift(cursor);
  return path;
}

export function pathMinutes(roads: Road[], path: NodeId[]): number {
  let total = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const road = roads.find((candidate) => candidate.open && ((candidate.a === path[index] && candidate.b === path[index + 1]) || (candidate.b === path[index] && candidate.a === path[index + 1])));
    if (!road) return Infinity;
    total += road.minutes;
  }
  return total;
}

class DisjointSet {
  private parent = new Map<NodeId, NodeId>(nodeIds.map((id) => [id, id]));
  private rank = new Map<NodeId, number>(nodeIds.map((id) => [id, 0]));
  find(id: NodeId): NodeId { const parent = this.parent.get(id)!; if (parent !== id) this.parent.set(id, this.find(parent)); return this.parent.get(id)!; }
  union(a: NodeId, b: NodeId): boolean {
    let rootA = this.find(a); let rootB = this.find(b);
    if (rootA === rootB) return false;
    if (this.rank.get(rootA)! < this.rank.get(rootB)!) [rootA, rootB] = [rootB, rootA];
    this.parent.set(rootB, rootA);
    if (this.rank.get(rootA) === this.rank.get(rootB)) this.rank.set(rootA, this.rank.get(rootA)! + 1);
    return true;
  }
}

export function kruskal(roads: Road[]): TreeResult {
  const dsu = new DisjointSet(); const edges: Road[] = []; const steps: TreeStep[] = [];
  for (const road of roads.filter((candidate) => candidate.open).sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id))) {
    const accepted = dsu.union(road.a, road.b);
    if (accepted) edges.push(road);
    steps.push({ edge: road, accepted, reason: accepted ? 'Connects two separate components' : 'Rejected because it would create a cycle' });
    if (edges.length === nodeIds.length - 1) break;
  }
  return { edges, steps, total: edges.reduce((sum, road) => sum + road.minutes, 0), complete: edges.length === nodeIds.length - 1 };
}

export function prim(roads: Road[], start: NodeId): TreeResult {
  const visited = new Set<NodeId>([start]); const edges: Road[] = []; const steps: TreeStep[] = [];
  while (visited.size < nodeIds.length) {
    const candidate = roads.filter((road) => road.open && (visited.has(road.a) !== visited.has(road.b))).sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id))[0];
    if (!candidate) break;
    edges.push(candidate); visited.add(visited.has(candidate.a) ? candidate.b : candidate.a);
    steps.push({ edge: candidate, accepted: true, reason: 'Cheapest road from the current tree to a new junction' });
  }
  return { edges, steps, total: edges.reduce((sum, road) => sum + road.minutes, 0), complete: edges.length === nodeIds.length - 1 };
}

export type RootedTree = { parent: Partial<Record<NodeId, NodeId | null>>; levels: Partial<Record<NodeId, number>>; children: Record<NodeId, NodeId[]>; order: NodeId[]; height: number };
export function rootTree(edges: Road[], root: NodeId): RootedTree {
  const graph = adjacency(edges.map((road) => ({ ...road, open: true })));
  const parent: Partial<Record<NodeId, NodeId | null>> = { [root]: null };
  const levels: Partial<Record<NodeId, number>> = { [root]: 0 };
  const order = [root];
  for (let index = 0; index < order.length; index += 1) {
    const current = order[index];
    for (const { to } of graph[current]) if (!(to in parent)) { parent[to] = current; levels[to] = levels[current]! + 1; order.push(to); }
  }
  const children = Object.fromEntries(nodeIds.map((id) => [id, [] as NodeId[]])) as Record<NodeId, NodeId[]>;
  for (const id of order) { const p = parent[id]; if (p) children[p].push(id); }
  return { parent, levels, children, order, height: Math.max(0, ...Object.values(levels)) };
}
