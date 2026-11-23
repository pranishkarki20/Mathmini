import { initialRoads, locations, type NodeId } from './data/network';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
export type Condition = 'normal' | 'moderate' | 'heavy' | 'severe' | 'closed' | 'unobserved' | 'simulated';
export type RoadProperties = { roadId: string; name: string; highway: string; distanceM: number; baseSpeedKph: number; speedKph?: number | null; estimatedTravelTimeMinutes?: number; condition: Condition; closed?: boolean; dataSource?: string; source?: string; isSimulated?: boolean; lastUpdated?: string; assumedMinutes?: number; oneway?: boolean };
export type Feature = { type: 'Feature'; id: string; geometry: { type: 'LineString'; coordinates: [number, number][] }; properties: RoadProperties };
export type Junction = { code: NodeId; name: string; lat: number; lon: number };
export type Edge = { id: string; roadId: string; name: string; highway: string; a: string; b: string; coordinates: [number, number][]; distanceM: number; baseSpeedKph: number; assumedMinutes?: number; oneway: boolean };
export type TrafficRoad = { roadId: string; name: string; speedKph?: number | null; condition: Condition; distanceM: number; estimatedTravelTimeMinutes: number; source: string; isSimulated: boolean; lastUpdated: string; closed: boolean };
export type Incident = { id: number; road_id: string; location_name: string; latitude: number; longitude: number; kind: string; severity: string; description: string; status: 'active' | 'resolved'; reported_at: string; resolved_at?: string | null };
export type NetworkData = { source: string; sourceLabel: string; isLiveTraffic: boolean; attribution: string; updatedAt: string; refreshError?: string; junctions: Junction[]; geojson: { type: 'FeatureCollection'; features: Feature[] }; edges: Edge[]; nodes?: Record<string, [number, number]>; traffic: TrafficRoad[]; incidents: Incident[] };
export type RouteSegment = { id: string; roadId: string; name: string; distanceM: number; travelTimeMinutes: number; coordinates: [number, number][] };
export type RouteResult = { path: string[]; segments: RouteSegment[]; distanceM: number; travelTimeMinutes: number | null; normalTimeMinutes: number | null; timeSavedMinutes?: number; delayMinutes?: number; reachable: boolean; algorithm: string; preference?: string; steps: { current: string; visitedCount: number; cost: number; costUnit: string; relaxedRoads: string[] }[]; alternativeRoutes: RouteResult[]; isSimulated: boolean; dataSource: string; networkSource?: string; closedRoads: string[]; providerComparison?: { duration: string; distanceM: number }; providerWarning?: string };
export type SensorSite = { id: number; code: string; name: string; latitude: number; longitude: number; candidate: boolean; active: boolean; install_cost: string; maintenance_cost_year: string };
export type SensorConnection = { id: number; a: string; b: string; distance_m: number; install_cost: string; maintenance_cost_year: string; connected: boolean };
export type SensorResult = { algorithm: string; edges: { id: string; a: string; b: string; distanceM: number; installCost: number; maintenanceCostYear: number }[]; trace: { edgeId: string; accepted: boolean; reason: string }[]; totalInstallCost: number; maintenanceCostYear: number; siteCount: number; connectionCount: number; connected: boolean; alternativeConnectionCost: number; savings: number; redundantConnections: { id: string; a: string; b: string; distanceM: number; installCost: number }[]; dataSource?: string };
export type AnalyticsData = { networkSource: string; trafficSource: string; lastUpdated: string; trendDisclaimer: string; summary: { junctionCount: number; roadCount: number; activeIncidents: number; blockedRoads: number; estimatedAtoGMinutes: number | null; sensorConnectionsCost: number }; roads: TrafficRoad[]; congestionTrend: { hour: string; congestionIndex: number }[] };
export type HealthData = { status: string; dataSource: string; isLiveTraffic: boolean; providers: { selectedProvider: string; googleRoutes: { configured: boolean; status: string }; tomtomTraffic: { configured: boolean; status: string }; simulation: { available: boolean; status: string } }; database: string; updatedAt: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError'; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.detail || `Request failed (${response.status})`, response.status);
  return data as T;
}
export const api = {
  health: () => request<HealthData>('/health/'),
  network: (refresh = false) => request<NetworkData>(`/network/${refresh ? '?refresh=1' : ''}`),
  route: (payload: { start: string; destination: string; algorithm: 'dijkstra' | 'astar'; travelMode: string; preference: string; simulation?: { roadFactors: Record<string, number> } }) => request<RouteResult>('/routes/', { method: 'POST', body: JSON.stringify(payload) }),
  incidents: () => request<Incident[]>('/incidents/'),
  createIncident: (payload: Partial<Incident>) => request<Incident>('/incidents/', { method: 'POST', body: JSON.stringify(payload) }),
  resolveIncident: (id: number) => request<Incident>(`/incidents/${id}/resolve/`, { method: 'POST', body: '{}' }),
  setTraffic: (road_id: string, speed_kph: number, source: 'manual' | 'simulation') => request<{ roadId: string; speedKph: number; source: string; isSimulated: boolean; lastUpdated: string }>('/traffic/', { method: 'POST', body: JSON.stringify({ road_id, speed_kph, source }) }),
  sensors: () => request<{ sites: SensorSite[]; connections: SensorConnection[]; dataSource: string }>('/sensors/'),
  configureSensors: (activeSites: string[], disabledConnectionIds: number[]) => request<{ sites: SensorSite[]; connections: SensorConnection[] }>('/sensors/', { method: 'POST', body: JSON.stringify({ activeSites, disabledConnectionIds }) }),
  optimizeSensors: (algorithm: 'prim' | 'kruskal', redundant: boolean, costMultiplier = 1) => request<SensorResult>('/sensors/optimize/', { method: 'POST', body: JSON.stringify({ algorithm, redundant, costMultiplier }) }),
  signals: () => request<SignalResult>('/signals/'),
  analyzeSignal: (payload: SignalInput) => request<SignalResult>('/signals/', { method: 'POST', body: JSON.stringify(payload) }),
  analytics: () => request<AnalyticsData>('/analytics/'),
  report: () => request<Record<string, unknown>>('/reports/'),
};
export type SignalInput = { junction_code: string; junction_name: string; vehicle_count: number; average_wait_seconds: number; queue_length_m: number; cycle_duration_seconds: number };
export type SignalResult = { measurement: SignalInput; congestionScore: number; level: string; recommendedCycleSeconds: number; suggestedGreenSeconds: number; source: string; explanation: string };

const geo: Record<NodeId, [number, number]> = {
  A: [12.9177, 77.6233], B: [12.9209, 77.6505], C: [12.9121, 77.6446], D: [12.9252, 77.6700],
  E: [12.9304, 77.6781], F: [12.9377, 77.6974], G: [12.9555, 77.6980],
};
export function localFallbackNetwork(): NetworkData {
  const edges: Edge[] = initialRoads.map((road) => {
    const start = geo[road.a]; const end = geo[road.b]; const distanceM = Math.round(Math.hypot((end[0] - start[0]) * 111320, (end[1] - start[1]) * 111320 * Math.cos(start[0] * Math.PI / 180)));
    return { id: `model-${road.a}${road.b}`, roadId: `model-${road.a}${road.b}`, name: `Corridor model link ${road.a}–${road.b}`, highway: 'model', a: road.a, b: road.b, coordinates: [[start[1], start[0]], [end[1], end[0]]], distanceM, baseSpeedKph: distanceM / (road.minutes / 60), assumedMinutes: road.minutes, oneway: false };
  });
  const features = edges.map((edge) => ({ type: 'Feature' as const, id: edge.id, geometry: { type: 'LineString' as const, coordinates: edge.coordinates }, properties: { roadId: edge.roadId, name: edge.name, highway: edge.highway, distanceM: edge.distanceM, baseSpeedKph: edge.baseSpeedKph, condition: 'moderate' as Condition, source: 'corridor simulation', isSimulated: true, assumedMinutes: edge.assumedMinutes, oneway: false } }));
  return { source: 'simulation_fallback', sourceLabel: 'Corridor model · API offline (not OSM road geometry)', isLiveTraffic: false, attribution: '© OpenStreetMap contributors', updatedAt: new Date().toISOString(), junctions: locations.map((location) => ({ code: location.id, name: location.name, lat: geo[location.id][0], lon: geo[location.id][1] })), geojson: { type: 'FeatureCollection', features }, edges, nodes: Object.fromEntries(Object.entries(geo).map(([code, point]) => [code, point])), traffic: edges.map((edge) => ({ roadId: edge.roadId, name: edge.name, speedKph: edge.baseSpeedKph, condition: 'moderate', distanceM: edge.distanceM, estimatedTravelTimeMinutes: edge.assumedMinutes!, source: 'Local simulation model', isSimulated: true, lastUpdated: new Date().toISOString(), closed: false })), incidents: [] };
}

export function localRoute(network: NetworkData, start: NodeId, destination: NodeId, algorithm: 'dijkstra' | 'astar', preference: 'fastest' | 'shortest', factors: Record<string, number> = {}): RouteResult {
  const graph = new Map<string, { edge: Edge; to: string; time: number; cost: number }[]>();
  network.edges.forEach((edge) => {
    const factor = factors[edge.roadId] ?? 1;
    const time = ((edge.assumedMinutes ?? edge.distanceM / Math.max(edge.baseSpeedKph, 1) * .06) * factor);
    const cost = preference === 'shortest' ? edge.distanceM : time;
    graph.set(edge.a, [...(graph.get(edge.a) ?? []), { edge, to: edge.b, time, cost }]);
    if (!edge.oneway) graph.set(edge.b, [...(graph.get(edge.b) ?? []), { edge, to: edge.a, time, cost }]);
  });
  const coords = network.nodes ?? Object.fromEntries(network.junctions.map((item) => [item.code, [item.lon, item.lat] as [number, number]]));
  const geo = (code: string): [number, number] => { const item = network.junctions.find((candidate) => candidate.code === code)!; return [item.lon, item.lat]; };
  const closestNode = (code: NodeId) => graph.has(code) ? code : Object.keys(coords).reduce((best, node) => {
    const target = geo(code); const point = coords[node]; const bestPoint = coords[best];
    const distance = (candidate: [number, number]) => Math.hypot((candidate[1] - target[1]) * 111320, (candidate[0] - target[0]) * 111320 * Math.cos(target[1] * Math.PI / 180));
    return distance(point) < distance(bestPoint) ? node : best;
  }, Object.keys(coords)[0]);
  const snappedStart = closestNode(start); const snappedEnd = closestNode(destination);
  const heuristic = (code: string) => {
    if (preference !== 'shortest' || algorithm !== 'astar') return 0;
    const a = coords[code]; const b = coords[snappedEnd];
    return a && b ? Math.hypot((b[1] - a[1]) * 111320, (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180)) : 0;
  };
  const queue: { node: string; cost: number; priority: number }[] = [{ node: snappedStart, cost: 0, priority: 0 }];
  const dist = new Map<string, number>([[snappedStart, 0]]); const previous = new Map<string, { from: string; edge: Edge; time: number }>(); const steps: RouteResult['steps'] = []; const settled = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => a.priority - b.priority || a.cost - b.cost); const current = queue.shift()!;
    if (settled.has(current.node) || current.cost > (dist.get(current.node) ?? Infinity)) continue;
    settled.add(current.node); const relaxed: string[] = [];
    for (const item of graph.get(current.node) ?? []) {
      if (!item.edge || network.incidents.some((incident) => incident.status === 'active' && incident.road_id === item.edge.roadId && (incident.kind === 'closure' || (incident.kind === 'accident' && incident.severity === 'critical')))) continue;
      const nextCost = current.cost + item.cost;
      if (nextCost < (dist.get(item.to) ?? Infinity)) { dist.set(item.to, nextCost); previous.set(item.to, { from: current.node, edge: item.edge, time: item.time }); relaxed.push(item.edge.roadId); queue.push({ node: item.to, cost: nextCost, priority: nextCost + heuristic(item.to) }); }
    }
    steps.push({ current: current.node, visitedCount: settled.size, cost: current.cost, costUnit: preference === 'shortest' ? 'm' : 'min', relaxedRoads: relaxed });
    if (current.node === snappedEnd) break;
  }
  if (!dist.has(snappedEnd)) return { path: [], segments: [], distanceM: 0, travelTimeMinutes: null, normalTimeMinutes: null, reachable: false, algorithm, steps, alternativeRoutes: [], isSimulated: true, dataSource: 'local simulation', closedRoads: [] };
  const path = [snappedEnd]; const segments: RouteSegment[] = [];
  for (let node = snappedEnd; node !== snappedStart;) { const prior = previous.get(node)!; const segmentCoords = prior.edge.a === prior.from ? prior.edge.coordinates : [...prior.edge.coordinates].reverse(); segments.unshift({ id: prior.edge.id, roadId: prior.edge.roadId, name: prior.edge.name, distanceM: prior.edge.distanceM, travelTimeMinutes: prior.time, coordinates: segmentCoords }); node = prior.from; path.unshift(node); }
  const totalTime = segments.reduce((sum, segment) => sum + segment.travelTimeMinutes, 0);
  return { path, segments, distanceM: segments.reduce((sum, segment) => sum + segment.distanceM, 0), travelTimeMinutes: Math.round(totalTime * 10) / 10, normalTimeMinutes: totalTime, timeSavedMinutes: 0, delayMinutes: 0, reachable: true, algorithm, preference, steps, alternativeRoutes: [], isSimulated: true, dataSource: network.sourceLabel, closedRoads: [] };
}
