
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
export type Condition = 'normal' | 'moderate' | 'heavy' | 'severe' | 'closed' | 'unobserved' | 'simulated';
export type RoadProperties = { roadId: string; name: string; highway: string; distanceM: number; baseSpeedKph: number; speedKph?: number | null; estimatedTravelTimeMinutes?: number; condition: Condition; closed?: boolean; dataSource?: string; source?: string; isSimulated?: boolean; lastUpdated?: string; assumedMinutes?: number; oneway?: boolean };
export type Feature = { type: 'Feature'; id: string; geometry: { type: 'LineString'; coordinates: [number, number][] }; properties: RoadProperties };
export type Junction = { code: string; name: string; lat: number; lon: number };
export type Edge = { id: string; roadId: string; name: string; highway: string; a: string; b: string; coordinates: [number, number][]; distanceM: number; baseSpeedKph: number; assumedMinutes?: number; oneway: boolean };
export type TrafficRoad = { roadId: string; name: string; speedKph?: number | null; condition: Condition; distanceM: number; estimatedTravelTimeMinutes: number; source: string; isSimulated: boolean; lastUpdated: string; closed: boolean };
export type Incident = { id: number; road_id: string; location_name: string; latitude: number; longitude: number; kind: string; severity: string; description: string; status: 'active' | 'resolved'; reported_at: string; resolved_at?: string | null };
export type NetworkData = { source: string; sourceLabel: string; isLiveTraffic: boolean; attribution: string; updatedAt: string; refreshError?: string; junctions: Junction[]; geojson: { type: 'FeatureCollection'; features: Feature[] }; edges: Edge[]; nodes?: Record<string, [number, number]>; traffic: TrafficRoad[]; incidents: Incident[] };
export type RouteSegment = { id: string; roadId: string; name: string; distanceM: number; travelTimeMinutes: number; coordinates: [number, number][] };
export type RouteResult = { path: string[]; segments: RouteSegment[]; distanceM: number; travelTimeMinutes: number | null; normalTimeMinutes: number | null; timeSavedMinutes?: number; delayMinutes?: number; reachable: boolean; algorithm: string; preference?: string; alternativeRoutes: RouteResult[]; isSimulated: boolean; dataSource: string; networkSource?: string; closedRoads: string[]; providerComparison?: { duration: string; distanceM: number }; providerWarning?: string };
export type SensorSite = { id: number; code: string; name: string; latitude: number; longitude: number; candidate: boolean; active: boolean; install_cost: string; maintenance_cost_year: string };
export type SensorConnection = { id: number; a: string; b: string; distance_m: number; install_cost: string; maintenance_cost_year: string; connected: boolean };
export type SensorResult = { algorithm: string; edges: { id: string; a: string; b: string; distanceM: number; installCost: number; maintenanceCostYear: number }[]; totalInstallCost: number; maintenanceCostYear: number; siteCount: number; connectionCount: number; connected: boolean; alternativeConnectionCost: number; savings: number; redundantConnections: { id: string; a: string; b: string; distanceM: number; installCost: number }[]; dataSource?: string };
export type AnalyticsData = { networkSource: string; trafficSource: string; lastUpdated: string; trendDisclaimer: string; summary: { junctionCount: number; roadCount: number; activeIncidents: number; blockedRoads: number; estimatedAtoGMinutes: number | null; sensorConnectionsCost: number }; roads: TrafficRoad[]; congestionTrend: { hour: string; congestionIndex: number }[] };
export type HealthData = { status: string; dataSource: string; isLiveTraffic: boolean; providers: { placeSearch: { service: string; status: string; policy: string }; routing: { service: string; status: string; endpoint: string }; traffic: { status: string; message: string } }; database: string; updatedAt: string };
export type OSMPlace = { placeId: string; name: string; displayName: string; latitude: number; longitude: number; osmType: string; osmId: number; category: string; type: string };
export type OSRMRoute = { id: number; distanceMeters: number; durationSeconds: number; retrievedAt: string; geometry: { type: 'LineString'; coordinates: [number, number][] }; legs: { summary: string; distanceMeters: number; durationSeconds: number; steps: { name: string; distanceMeters: number; durationSeconds: number; type: string; modifier: string }[] }[] };
export type OSRMRouteResponse = { routes: OSRMRoute[]; source: string; retrievedAt: string };
export type AreaJunction = { id: string; name: string; latitude: number; longitude: number; roadCount: number };
export type AreaNetworkData = { source: string; sourceLabel: string; bbox: [number, number, number, number]; retrievedAt?: string; edges: Edge[]; nodes: Record<string, [number, number]>; features: { type: 'FeatureCollection'; features: Feature[] }; junctions: AreaJunction[]; metrics: { roadSegments: number; mappedRoads: number; junctions: number; totalRoadDistanceMeters: number; connectedAreas: number; criticalJunctions: number; criticalJunctionIds: string[]; criticalRoadSegments: number; criticalRoadIds: string[]; highDegreeJunctionIds: string[] }; refreshError?: string };
export type AreaGraphRoute = { reachable: boolean; segments: { roadId: string; name: string; coordinates: [number, number][]; distanceMeters: number; estimatedDurationMinutes?: number }[]; distanceMeters: number; estimatedDurationMinutes?: number | null; closedRoadIds: string[]; junctionPath?: string[]; message?: string };
export type InfrastructurePlan = { connected: boolean; selectedJunctions: string[]; connections: { fromJunction: string; toJunction: string; distanceMeters: number; estimatedInstallationCost: number; segments: { roadId: string; name: string; coordinates: [number, number][]; distanceMeters: number }[] }[]; totalDistanceMeters: number; estimatedInstallationCost: number; costBasis: string };
export type ClosureScenario = { id: number; name: string; bbox: [number, number, number, number]; closedRoadIds: string[]; start: string; destination: string; updatedAt: string };

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
  networkArea: (bbox: [number, number, number, number], refresh = false) => request<AreaNetworkData>(`/network/area/?south=${bbox[0]}&west=${bbox[1]}&north=${bbox[2]}&east=${bbox[3]}${refresh ? '&refresh=1' : ''}`),
  routeArea: (payload: { bbox: [number, number, number, number]; start: string; destination: string; closedRoadIds: string[]; preference?: 'shortest' | 'fastest' }) => request<AreaGraphRoute>('/network/area/route/', { method: 'POST', body: JSON.stringify(payload) }),
  planInfrastructure: (payload: { bbox: [number, number, number, number]; junctionIds: string[]; estimatedCostPerKm: number; algorithm?: 'prim' | 'kruskal'; objective?: 'distance' | 'estimated_cost' }) => request<InfrastructurePlan>('/infrastructure/plan/', { method: 'POST', body: JSON.stringify(payload) }),
  saveSensorPlan: (payload: { name: string; bbox: [number, number, number, number]; junctionIds: string[]; config: Record<string, unknown> }) => request<{ id: number; name: string; updatedAt: string }>('/sensor-plans/', { method: 'POST', body: JSON.stringify(payload) }),
  latestClosureScenario: () => request<{ scenario: ClosureScenario | null }>('/closure-scenarios/'),
  saveClosureScenario: (payload: { name: string; bbox: [number, number, number, number]; closedRoadIds: string[]; start: string; destination: string }) => request<{ id: number; name: string; updatedAt: string }>('/closure-scenarios/', { method: 'POST', body: JSON.stringify(payload) }),
  latestSensorPlan: () => request<{ plan: { id: number; name: string; bbox: [number, number, number, number]; junctionIds: string[]; config: Record<string, unknown>; updatedAt: string } | null }>('/sensor-plans/'),
  route: (payload: { start: string; destination: string; algorithm: 'dijkstra' | 'astar'; travelMode: string; preference: string; simulation?: { roadFactors: Record<string, number> } }) => request<RouteResult>('/routes/', { method: 'POST', body: JSON.stringify(payload) }),
  searchPlaces: (query: string) => request<{ results: OSMPlace[]; source: string }>(`/places/search/?q=${encodeURIComponent(query)}`),
  routeOSRM: (payload: { coordinates: { latitude: number; longitude: number }[]; alternatives?: boolean }) => request<OSRMRouteResponse>('/routes/osrm/', { method: 'POST', body: JSON.stringify(payload) }),
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

export function localFallbackNetwork(): NetworkData {
  const now = new Date().toISOString();
  return { source: 'unavailable', sourceLabel: 'No road extract loaded', isLiveTraffic: false, attribution: '? OpenStreetMap contributors', updatedAt: now, junctions: [], geojson: { type: 'FeatureCollection', features: [] }, edges: [], nodes: {}, traffic: [], incidents: [] };
}

