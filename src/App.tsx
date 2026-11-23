import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, BarChart3, BookOpen,
  CheckCircle2, ChevronDown, Clock3, CloudDownload, Compass, Gauge,
  Info, MapPinned, Menu, Network, Play, Radio,
  RefreshCw, Route, Shield, Signal, Siren, SlidersHorizontal,
  Sparkles, Timer, Users, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import TrafficMap from './components/TrafficMap';
import { api, ApiError, localFallbackNetwork, localRoute, type AnalyticsData, type HealthData, type Incident, type NetworkData, type RouteResult, type SensorConnection, type SensorResult, type SensorSite, type SignalInput, type SignalResult, type TrafficRoad } from './api';
import { locations, nodeIds, type NodeId } from './data/network';

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));

type Page = 'overview' | 'routes' | 'incidents' | 'sensors' | 'signals' | 'analytics' | 'education';
type Role = 'Administrator' | 'Traffic operator' | 'Viewer';
const nav: { id: Page; title: string; icon: LucideIcon; group: string }[] = [
  { id: 'overview', title: 'Control centre', icon: Activity, group: 'OPERATIONS' },
  { id: 'routes', title: 'Route optimizer', icon: Route, group: 'OPERATIONS' },
  { id: 'incidents', title: 'Incidents & closures', icon: Siren, group: 'OPERATIONS' },
  { id: 'sensors', title: 'Sensor infrastructure', icon: Radio, group: 'NETWORK DESIGN' },
  { id: 'signals', title: 'Signal analysis', icon: Signal, group: 'NETWORK DESIGN' },
  { id: 'analytics', title: 'Traffic analytics', icon: BarChart3, group: 'INTELLIGENCE' },
  { id: 'education', title: 'Algorithm lab', icon: BookOpen, group: 'INTELLIGENCE' },
];
const initialSignal: SignalInput = { junction_code: 'D', junction_name: 'Ibbaluru', vehicle_count: 75, average_wait_seconds: 55, queue_length_m: 70, cycle_duration_seconds: 90 };
const conditionColors: Record<string, string> = { normal: '#38c997', moderate: '#e9ce58', heavy: '#ef9f4a', severe: '#eb6571', closed: '#7d8999', simulated: '#58bbd4', unobserved: '#72819a' };

function money(value: number | string) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0); }
function timeLabel(value: number | null | undefined) { return value === null || value === undefined || !Number.isFinite(value) ? 'No route' : `${Math.round(value * 10) / 10} min`; }
function numberLabel(value: number) { return new Intl.NumberFormat('en-IN').format(value); }
function providerMinutes(value: string) { const seconds = Number.parseFloat(value); return Number.isFinite(seconds) ? seconds / 60 : null; }
function timeSince(input?: string) { if (!input) return 'No observation'; const date = new Date(input); return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }); }
function getJunction(network: NetworkData, code: string) { return network.junctions.find((item) => item.code === code) ?? network.junctions[0]; }

function localSensors(network: NetworkData): { sites: SensorSite[]; connections: SensorConnection[] } {
  const sites = network.junctions.map((item, index) => ({ id: index + 1, code: item.code, name: item.name, latitude: item.lat, longitude: item.lon, candidate: true, active: true, install_cost: '95000', maintenance_cost_year: '7200' }));
  const connections: SensorConnection[] = [];
  for (let a = 0; a < sites.length; a += 1) for (let b = a + 1; b < sites.length; b += 1) {
    const left = sites[a]; const right = sites[b]; const dist = Math.hypot((left.latitude - right.latitude) * 111320, (left.longitude - right.longitude) * 111320 * Math.cos(left.latitude * Math.PI / 180));
    connections.push({ id: connections.length + 1, a: left.code, b: right.code, distance_m: Math.round(dist), install_cost: String(Math.round(65000 + dist * 46)), maintenance_cost_year: String(Math.round((65000 + dist * 46) * .045)), connected: true });
  }
  return { sites, connections };
}

function localSensorOptimize(sites: SensorSite[], connections: SensorConnection[], algorithm: 'prim' | 'kruskal', redundant: boolean, multiplier: number): SensorResult {
  const candidates = connections.filter((edge) => edge.connected && sites.some((site) => site.code === edge.a && site.candidate) && sites.some((site) => site.code === edge.b && site.candidate)).map((edge) => ({ id: String(edge.id), a: edge.a, b: edge.b, distanceM: edge.distance_m, installCost: Number(edge.install_cost) * multiplier, maintenanceCostYear: Number(edge.maintenance_cost_year) * multiplier })).sort((a, b) => a.installCost - b.installCost || a.id.localeCompare(b.id));
  const codes = sites.filter((site) => site.candidate).map((site) => site.code); const chosen: typeof candidates = []; const trace: SensorResult['trace'] = [];
  if (algorithm === 'prim' && codes.length) {
    const reached = new Set([codes[0]]);
    while (reached.size < codes.length) { const edge = candidates.find((item) => reached.has(item.a) !== reached.has(item.b)); if (!edge) break; chosen.push(edge); reached.add(reached.has(edge.a) ? edge.b : edge.a); trace.push({ edgeId: edge.id, accepted: true, reason: 'Cheapest edge from the current tree to a new site' }); }
  } else {
    const parent = new Map(codes.map((code) => [code, code])); const find = (node: string): string => { const p = parent.get(node)!; if (p !== node) parent.set(node, find(p)); return parent.get(node)!; };
    for (const edge of candidates) { const a = find(edge.a); const b = find(edge.b); const accepted = a !== b; if (accepted) { parent.set(a, b); chosen.push(edge); } trace.push({ edgeId: edge.id, accepted, reason: accepted ? 'Connects two components' : 'Rejected because it creates a cycle' }); if (chosen.length === codes.length - 1) break; }
  }
  const cost = chosen.reduce((sum, edge) => sum + edge.installCost, 0); const allCost = candidates.reduce((sum, edge) => sum + edge.installCost, 0); const remaining = candidates.filter((edge) => !chosen.some((selected) => selected.id === edge.id));
  return { algorithm, edges: chosen, trace, totalInstallCost: cost, maintenanceCostYear: chosen.reduce((sum, edge) => sum + edge.maintenanceCostYear, 0), siteCount: codes.length, connectionCount: chosen.length, connected: chosen.length === Math.max(0, codes.length - 1), alternativeConnectionCost: allCost, savings: allCost - cost, redundantConnections: redundant ? remaining.slice(0, Math.max(1, Math.floor(codes.length / 3))) : [], dataSource: 'Local model · estimated installation costs' };
}

function App() {
  const [page, setPage] = useState<Page>('overview');
  const [network, setNetwork] = useState<NetworkData>(() => localFallbackNetwork());
  const [apiOnline, setApiOnline] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loadingNetwork, setLoadingNetwork] = useState(true);
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<Role>('Traffic operator');
  const [mobileNav, setMobileNav] = useState(false);
  const [start, setStart] = useState<NodeId>('A');
  const [destination, setDestination] = useState<NodeId>('G');
  const [algorithm, setAlgorithm] = useState<'dijkstra' | 'astar'>('dijkstra');
  const [preference, setPreference] = useState<'fastest' | 'shortest'>('fastest');
  const [travelMode, setTravelMode] = useState('driving');
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedRoad, setSelectedRoad] = useState<TrafficRoad | null>(null);
  const [mapFilters, setMapFilters] = useState<string[]>([]);
  const [incidentKind, setIncidentKind] = useState('accident');
  const [incidentSeverity, setIncidentSeverity] = useState('medium');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentLocation, setIncidentLocation] = useState<NodeId>('D');
  const [incidentRoadId, setIncidentRoadId] = useState('');
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [simulationFactors, setSimulationFactors] = useState<Record<string, number>>({});
  const [simulationSpeed, setSimulationSpeed] = useState(22);
  const [sensorSites, setSensorSites] = useState<SensorSite[]>([]);
  const [sensorConnections, setSensorConnections] = useState<SensorConnection[]>([]);
  const [sensorAlgorithm, setSensorAlgorithm] = useState<'prim' | 'kruskal'>('kruskal');
  const [sensorResult, setSensorResult] = useState<SensorResult | null>(null);
  const [redundancy, setRedundancy] = useState(false);
  const [costMultiplier, setCostMultiplier] = useState(1);
  const [sensorStep, setSensorStep] = useState(0);
  const [signalInput, setSignalInput] = useState<SignalInput>(initialSignal);
  const [signalResult, setSignalResult] = useState<SignalResult | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [signalSaving, setSignalSaving] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [trafficSource, setTrafficSource] = useState('Simulation · modeled baseline');
  const [presentation, setPresentation] = useState(false);
  const [presentationSlide, setPresentationSlide] = useState(0);

  const canOperate = role !== 'Viewer';
  const currentPage = nav.find((item) => item.id === page)?.title ?? 'Control centre';
  const dataUpdatedAt = network.updatedAt;
  const activeIncidents = incidents.filter((incident) => incident.status === 'active');
  const closures = activeIncidents.filter((incident) => incident.kind === 'closure' || (incident.kind === 'accident' && incident.severity === 'critical')).map((incident) => incident.road_id).filter(Boolean);
  const blockedRoadCount = new Set([...closures, ...network.traffic.filter((road) => road.closed).map((road) => road.roadId)]).size;
  const selectedFeature = selectedRoad ?? (network.traffic.length ? network.traffic.find((road) => road.roadId === routeResult?.segments[0]?.roadId) ?? null : null);
  const routeSavings = routeResult?.timeSavedMinutes ?? 0;
  const displayedPage = presentation ? (['overview', 'routes', 'sensors', 'incidents', 'sensors', 'incidents', 'sensors', 'education'] as Page[])[presentationSlide] : page;

  const announce = useCallback((text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 5000); }, []);
  const loadNetwork = useCallback(async (refresh = false) => {
    setLoadingNetwork(true);
    try {
      const data = await api.network(refresh);
      setNetwork(data); setIncidents(data.incidents); setApiOnline(true);
      if (data.traffic.length) setTrafficSource(data.traffic[0].source);
      if (data.refreshError) announce(data.refreshError);
      return data;
    } catch {
      setApiOnline(false);
      setNetwork((previous) => previous.source === 'simulation_fallback' ? previous : localFallbackNetwork());
      return null;
    } finally { setLoadingNetwork(false); }
  }, [announce]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [networkResult, healthResult, sensorResult, signalResponse, analyticsResponse, incidentsResponse] = await Promise.allSettled([
        api.network(), api.health(), api.sensors(), api.signals(), api.analytics(), api.incidents(),
      ]);
      if (cancelled) return;
      if (networkResult.status === 'fulfilled') { setNetwork(networkResult.value); setIncidents(networkResult.value.incidents); setApiOnline(true); }
      if (healthResult.status === 'fulfilled') { setApiOnline(true); setHealth(healthResult.value); }
      if (sensorResult.status === 'fulfilled') { setSensorSites(sensorResult.value.sites); setSensorConnections(sensorResult.value.connections); }
      else { const data = localSensors(network); setSensorSites(data.sites); setSensorConnections(data.connections); }
      if (signalResponse.status === 'fulfilled') { setSignalResult(signalResponse.value); setSignalInput(signalResponse.value.measurement); }
      if (analyticsResponse.status === 'fulfilled') setAnalytics(analyticsResponse.value);
      if (incidentsResponse.status === 'fulfilled') setIncidents(incidentsResponse.value);
      if (healthResult.status === 'rejected' && networkResult.status === 'rejected') setApiOnline(false);
      setLoadingNetwork(false);
    })();
    return () => { cancelled = true; };
    // Boot once; the local fallback graph is intentionally stable for this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRouteLoading(true);
    const payload = { start, destination, algorithm, travelMode, preference, simulation: { roadFactors: simulationFactors } };
    api.route(payload).then((result) => { if (!cancelled) { setRouteResult(result); setApiOnline(true); } }).catch(() => {
      if (!cancelled) setRouteResult(localRoute(network, start, destination, algorithm, preference, simulationFactors));
    }).finally(() => { if (!cancelled) setRouteLoading(false); });
    return () => { cancelled = true; };
  }, [start, destination, algorithm, preference, travelMode, simulationFactors, network]);

  useEffect(() => {
    if (!apiOnline) return;
    api.analytics().then(setAnalytics).catch(() => undefined);
  }, [apiOnline, incidents, network]);

  useEffect(() => {
    if (!sensorSites.length) return;
    let cancelled = false;
    api.optimizeSensors(sensorAlgorithm, redundancy, costMultiplier).then((result) => { if (!cancelled) setSensorResult(result); }).catch(() => {
      if (!cancelled) setSensorResult(localSensorOptimize(sensorSites, sensorConnections, sensorAlgorithm, redundancy, costMultiplier));
    });
    return () => { cancelled = true; };
  }, [sensorAlgorithm, redundancy, costMultiplier, sensorSites, sensorConnections]);

  useEffect(() => { if (sensorResult) setSensorStep(0); }, [sensorAlgorithm, sensorResult?.trace.length]);

  const routeRequest = useCallback(async () => {
    setRouteLoading(true);
    try { const result = await api.route({ start, destination, algorithm, travelMode, preference, simulation: { roadFactors: simulationFactors } }); setRouteResult(result); setApiOnline(true); }
    catch { setRouteResult(localRoute(network, start, destination, algorithm, preference, simulationFactors)); }
    finally { setRouteLoading(false); }
  }, [start, destination, algorithm, travelMode, preference, simulationFactors, network]);

  const handleIncidentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canOperate) return;
    if ((incidentKind === 'closure' || (incidentKind === 'accident' && incidentSeverity === 'critical')) && !incidentRoadId) {
      announce('Choose the affected road segment so the route planner can apply this closure.');
      return;
    }
    const place = getJunction(network, incidentLocation);
    const payload = { road_id: incidentRoadId, location_name: place?.name ?? 'Bengaluru corridor', latitude: place?.lat ?? 12.926, longitude: place?.lon ?? 77.67, kind: incidentKind, severity: incidentSeverity, description: incidentDescription.trim() || `${incidentKind.replace('_', ' ')} reported near ${place?.name ?? 'Bengaluru corridor'}` };
    setIncidentSaving(true);
    try { const created = await api.createIncident(payload); setIncidents((items) => [created, ...items]); setApiOnline(true); await loadNetwork(); announce('Incident reported and added to the operator queue.'); }
    catch (error) { if (error instanceof ApiError && error.status === 403) announce(error.message); else { const created = { ...payload, id: Date.now(), status: 'active' as const, reported_at: new Date().toISOString() }; setIncidents((items) => [created, ...items]); setNetwork((current) => ({ ...current, incidents: [created, ...current.incidents] })); announce('Incident added to the local simulation. Start Django to persist operator reports.'); } }
    finally { setIncidentSaving(false); setIncidentDescription(''); }
  };

  const resolveIncident = async (incident: Incident) => {
    if (!canOperate) return;
    try { const updated = await api.resolveIncident(incident.id); setIncidents((items) => items.map((item) => item.id === updated.id ? updated : item)); await loadNetwork(); }
    catch (error) { if (error instanceof ApiError && error.status === 403) { announce(error.message); return; } setIncidents((items) => items.map((item) => item.id === incident.id ? { ...item, status: 'resolved', resolved_at: new Date().toISOString() } : item)); }
    announce(`Incident ${incident.id} resolved. The affected road is available for route calculations again.`);
  };

  const applySensorSites = async (nextSites: SensorSite[], nextConnections = sensorConnections) => {
    setSensorSites(nextSites); setSensorConnections(nextConnections);
    const activeCodes = nextSites.filter((item) => item.candidate).map((item) => item.code);
    const disabled = nextConnections.filter((item) => !item.connected).map((item) => item.id);
    try { const config = await api.configureSensors(activeCodes, disabled); setSensorSites(config.sites); setSensorConnections(config.connections); setApiOnline(true); }
    catch (error) { if (error instanceof ApiError && error.status === 403) announce(error.message); }
  };

  const submitSignal = async (event: React.FormEvent) => {
    event.preventDefault(); if (!canOperate) return;
    setSignalSaving(true);
    try { const result = await api.analyzeSignal(signalInput); setSignalResult(result); setApiOnline(true); announce('Signal queue analysis updated. This is advisory only.'); }
    catch (error) {
      if (error instanceof ApiError && error.status === 403) { announce(error.message); setSignalSaving(false); return; }
      const score = Math.min(100, Math.round(signalInput.vehicle_count * .25 + signalInput.average_wait_seconds * .2 + signalInput.queue_length_m * .15 + signalInput.vehicle_count / Math.max(signalInput.cycle_duration_seconds, 1) * 20));
      const cycle = Math.max(45, Math.min(150, Math.round(50 + score * .65)));
      setSignalResult({ measurement: signalInput, congestionScore: score, level: score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'moderate' : 'normal', recommendedCycleSeconds: cycle, suggestedGreenSeconds: Math.max(20, Math.min(cycle - 15, Math.round(cycle * (.35 + score / 220)))), source: 'Local operator simulation', explanation: 'Educational timing estimate only. This prototype does not control any traffic signals.' });
    }
    setSignalSaving(false);
  };

  const exportReport = async () => {
    setReportLoading(true);
    try {
      const report = await api.report();
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `smartflow-report-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
      announce('Operations report exported as JSON.');
    } catch { const report = { generatedAt: new Date().toISOString(), trafficSource, networkSource: network.sourceLabel, route: routeResult, incidents, analytics, sensorResult, note: 'Simulation/manual measurements only; this report contains no live traffic feed.' }; const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); link.download = `smartflow-simulation-report-${new Date().toISOString().slice(0, 10)}.json`; link.click(); announce('Local simulation report exported as JSON.'); }
    finally { setReportLoading(false); }
  };

  const refreshOsm = async () => { announce('Requesting a fresh OSM road extract from Overpass…'); const data = await loadNetwork(true); if (data?.source === 'openstreetmap') announce(`Loaded ${data.geojson.features.length.toLocaleString()} OpenStreetMap road features.`); else if (data) announce('OSM extract is unavailable. The explicitly labeled corridor model remains active.'); };
  const useJunction = (code: string) => { if (nodeIds.includes(code as NodeId)) { if (page === 'incidents') setIncidentLocation(code as NodeId); else if (page === 'routes') setDestination(code as NodeId); else setStart(code as NodeId); announce(`${code} selected for ${page === 'incidents' ? 'incident location' : page === 'routes' ? 'destination' : 'route origin'}.`); } };
  const toggleFilter = (value: string) => setMapFilters((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const selectRoad = (road: TrafficRoad) => { setSelectedRoad(road); setIncidentRoadId(road.roadId); setSimulationSpeed(Math.round(road.speedKph ?? 22)); };

  const sourceLine = <span className={`source-status ${network.source === 'openstreetmap' ? 'source-live' : 'source-sim'}`}><i />{network.sourceLabel}</span>;
  const header = <header className="command-header"><div className="command-title"><button className="mobile-nav-button icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={18} /></button><div><div className="crumb">SMARTFLOW <span>/</span> {currentPage.toUpperCase()}</div><h1>{page === 'overview' ? 'Traffic control centre' : currentPage}</h1></div></div><div className="header-controls"><div className="simulation-status"><span className="status-dot" /> {network.traffic.some((road) => !road.isSimulated) ? 'OBSERVED DATA' : 'SIMULATION MODE'}</div><label className="role-select"><Users size={13} /><select value={role} onChange={(event) => setRole(event.target.value as Role)} aria-label="Demo role display" title="Presentation control only. Django enforces permissions for API writes."><option>Administrator</option><option>Traffic operator</option><option>Viewer</option></select><ChevronDown size={12} /></label><button className="button button-export" disabled={reportLoading} onClick={exportReport}>{reportLoading ? <RefreshCw className="spin" size={14} /> : <CloudDownload size={14} />} Export report</button></div></header>;

  const locationSelect = (value: string, setValue: (value: NodeId) => void, label: string) => <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => setValue(event.target.value as NodeId)}>{locations.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label>;

  const mapPanel = (props: { title?: string; subtitle?: string; route?: RouteResult | null; showSensors?: boolean; compact?: boolean }) => <section className="surface map-card"><div className="surface-head"><div><div className="surface-title"><MapPinned size={16} /><h2>{props.title ?? 'Bengaluru corridor · road network'}</h2><span className="map-real-pill">{network.source === 'openstreetmap' ? 'REAL ROAD GEOMETRY' : 'MODEL CONNECTORS'}</span></div><p>{props.subtitle ?? 'Silk Board · Agara · HSR Layout · Ibbaluru · Bellandur · Marathahalli'}</p></div><div className="map-actions"><button className="button button-quiet" onClick={refreshOsm} disabled={loadingNetwork}><RefreshCw size={13} className={loadingNetwork ? 'spin' : ''} /> Refresh OSM</button><button className="icon-button" onClick={() => setMapFilters([])} title="Clear map filters"><SlidersHorizontal size={14} /></button></div></div><div className="map-filter-bar">{[['normal', 'Normal'], ['moderate', 'Moderate'], ['heavy', 'Heavy'], ['severe', 'Severe'], ['closed', 'Closed']].map(([id, label]) => <button key={id} className={`filter-chip ${mapFilters.includes(id) ? 'filter-selected' : ''}`} onClick={() => toggleFilter(id)}><i style={{ background: conditionColors[id] }} />{label}</button>)}<span className="filter-divider" /><span className="map-traffic-source">{trafficSource}</span></div><TrafficMap network={network} route={props.route?.segments ?? []} incidents={incidents} sensors={props.showSensors ? sensorResult : null} sensorSites={sensorSites} selectedRoad={selectedRoad} onRoadSelect={selectRoad} onJunctionSelect={useJunction} filterConditions={mapFilters} showSensors={props.showSensors} compact={props.compact} /></section>;

  const routeCard = (result: RouteResult | null, compact = false) => <div className={`route-result-card ${compact ? 'route-result-compact' : ''}`}><div className="route-result-top"><div><span className="panel-overline">{algorithm === 'astar' ? 'A* GEOGRAPHIC SEARCH' : 'DIJKSTRA SHORTEST PATH'} · {preference.toUpperCase()}</span><strong>{routeLoading ? 'Calculating…' : timeLabel(result?.travelTimeMinutes)}</strong></div><span className="route-result-icon"><Route size={17} /></span></div>{result?.reachable ? <><div className="route-places">{result.path.map((code, index) => { const place = locations.find((item) => item.id === code); return <span className="route-place" key={`${code}-${index}`}><b>{place?.id ?? code}</b><small>{place?.name ?? 'Road junction'}</small>{index < result.path.length - 1 && <i />}</span>; })}</div><div className="route-result-meta"><span><Compass size={12} />{(result.distanceM / 1000).toFixed(1)} km</span><span><Clock3 size={12} />Normal model {timeLabel(result.normalTimeMinutes)}</span><span className={routeSavings > 0 ? 'saved-time' : ''}><Zap size={12} />{routeSavings > 0 ? `${routeSavings} min saved` : 'Traffic-aware estimate'}</span><span className="simulation-label">{result.isSimulated ? 'SIMULATED' : result.dataSource.toUpperCase()}</span></div>{result.providerComparison && <div className="provider-comparison"><b>Google Routes traffic-aware check</b><span>{providerMinutes(result.providerComparison.duration) === null ? result.providerComparison.duration : timeLabel(providerMinutes(result.providerComparison.duration))} · {(result.providerComparison.distanceM / 1000).toFixed(1)} km</span><small>External benchmark; local graph estimate remains shown above.</small></div>}</> : <div className="route-no-result"><AlertTriangle size={15} />{routeLoading ? 'The route is being recalculated.' : 'No open route connects the selected junctions. Check active closures.'}</div>}{result?.providerWarning && <div className="inline-warning">{result.providerWarning}</div>}</div>;

  const routePanel = <div className="module-grid route-grid">{mapPanel({ title: 'Route map · traffic-aware path', subtitle: `${start} ${getJunction(network, start)?.name ?? ''} ? ${destination} ${getJunction(network, destination)?.name ?? ''}`, route: routeResult })}<section className="surface panel-column"><div className="surface-head"><div><div className="surface-title"><Route size={16} /><h2>Journey planner</h2></div><p>Dijkstra or A* on the current weighted road graph.</p></div><span className={`mini-state ${apiOnline ? 'mini-connected' : ''}`}>{apiOnline ? 'API CONNECTED' : 'LOCAL FALLBACK'}</span></div><div className="panel-form">{locationSelect(start, setStart, 'Starting location')}{locationSelect(destination, setDestination, 'Destination')}<div className="field-row"><label className="form-field"><span>Search algorithm</span><select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as 'dijkstra' | 'astar')}><option value="dijkstra">Dijkstra · shortest travel time</option><option value="astar">A* · geographic heuristic</option></select></label><label className="form-field"><span>Route preference</span><select value={preference} onChange={(event) => setPreference(event.target.value as 'fastest' | 'shortest')}><option value="fastest">Fastest estimated time</option><option value="shortest">Shortest distance</option></select></label></div><label className="form-field"><span>Travel mode</span><select value={travelMode} onChange={(event) => setTravelMode(event.target.value)}><option value="driving">Driving</option><option value="cycling">Cycling · modeled</option><option value="walking">Walking · modeled</option></select></label><button className="button button-primary button-wide" onClick={routeRequest} disabled={routeLoading || start === destination}><Route size={15} /> Calculate optimized route <ArrowRight size={15} /></button></div>{routeCard(routeResult)}<div className="step-trace"><div className="section-heading"><div><span className="panel-overline">ALGORITHM EXECUTION</span><h3>{algorithm === 'astar' ? 'A* search' : 'Dijkstra'} · visited junctions</h3></div><span className="step-count">{routeResult?.steps.length ?? 0} steps</span></div><div className="trace-list">{routeResult?.steps.slice(0, 10).map((step, index) => <div className={`trace-row ${index === 0 ? 'trace-highlight' : ''}`} key={`${step.current}-${index}`}><b>{String(index + 1).padStart(2, '0')}</b><span>{locations.find((item) => item.id === step.current)?.name ?? `OSM node ${step.current}`}</span><small>{step.visitedCount} visited</small><strong>{`${step.cost.toFixed(1)} ${step.costUnit}`}</strong></div>)}{!routeResult?.steps.length && <div className="empty-hint">Choose a trip to see the algorithm's visited-node trace.</div>}</div><p className="muted-note">A* uses straight-line distance as an admissible geographic heuristic. Route cost uses current edge travel-time estimates.</p></div></section></div>;

  const detailCard = selectedFeature && <div className="road-detail-card"><div className="road-detail-heading"><div><span className="panel-overline">SELECTED ROAD</span><strong>{selectedFeature.name}</strong></div><button className="icon-button" onClick={() => setSelectedRoad(null)} aria-label="Close road details"><X size={14} /></button></div><div className="road-detail-metrics"><div><span>Speed</span><b>{selectedFeature.speedKph ? `${selectedFeature.speedKph} km/h` : 'Unavailable'}</b></div><div><span>Travel estimate</span><b>{timeLabel(selectedFeature.estimatedTravelTimeMinutes)}</b></div><div><span>Distance</span><b>{(selectedFeature.distanceM / 1000).toFixed(2)} km</b></div><div><span>Condition</span><b className={`condition-text condition-${selectedFeature.condition}`}>{selectedFeature.closed ? 'Closed' : selectedFeature.condition}</b></div></div><div className="detail-source">Source: {selectedFeature.source} · Updated {timeSince(selectedFeature.lastUpdated)}{selectedFeature.isSimulated ? ' · simulated, not live' : ''}</div><div className="speed-editor"><span>Simulate traffic speed</span><div><input type="range" min="5" max="80" value={simulationSpeed} onChange={(event) => { setSimulationSpeed(Number(event.target.value)); }} /><b>{simulationSpeed} km/h</b></div><button className="button button-quiet" disabled={!canOperate} onClick={async () => { const base = network.geojson.features.find((item) => item.properties.roadId === selectedFeature.roadId)?.properties.baseSpeedKph ?? selectedFeature.speedKph ?? simulationSpeed; setSimulationFactors((current) => ({ ...current, [selectedFeature.roadId]: base / Math.max(simulationSpeed, 1) })); try { await api.setTraffic(selectedFeature.roadId, simulationSpeed, 'simulation'); await loadNetwork(); announce('Speed scenario saved to the demo API and route calculations updated.'); } catch (error) { if (error instanceof ApiError && error.status === 403) announce(`Local scenario applied to route calculations only. ${error.message}`); else { setNetwork((current) => ({ ...current, traffic: current.traffic.map((item) => item.roadId === selectedFeature.roadId ? { ...item, speedKph: simulationSpeed, source: 'Local simulation input', isSimulated: true, condition: simulationSpeed < 15 ? 'heavy' : 'moderate' } : item) })); announce('Local traffic simulation updated. Start Django to save this scenario.'); } } }}><Activity size={13} />Apply simulation</button></div></div>;

  const overview = <><div className="welcome-row"><div><span className="eyebrow">BENGALURU · OUTER RING ROAD CORRIDOR</span><h2>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, operator</h2><p>Monitor corridor conditions, model incidents, and plan a resilient sensor backbone.</p></div><button className="button button-outline" onClick={() => setPresentation(true)}><Play size={13} /> Start briefing</button></div><div className="metric-grid">{[
    { label: 'Road segments', value: numberLabel(network.traffic.length), note: network.source === 'openstreetmap' ? 'OpenStreetMap corridor' : 'Study corridor model', icon: MapPinned, color: 'blue' },
    { label: 'Active incidents', value: activeIncidents.length, note: `${blockedRoadCount} blocked roads`, icon: Siren, color: activeIncidents.length ? 'red' : 'green' },
    { label: 'Fastest A ? G', value: timeLabel(routeResult?.travelTimeMinutes), note: routeResult?.isSimulated ? 'Modeled traffic estimate' : 'Traffic-aware estimate', icon: Zap, color: 'cyan' },
    { label: 'Sensor backbone', value: sensorResult ? money(sensorResult.totalInstallCost) : '—', note: sensorResult?.connected ? `${sensorResult.connectionCount} connections · Prim/Kruskal` : 'Optimize candidate sensors', icon: Radio, color: 'amber' },
  ].map((item) => <div className="metric-card" key={item.label}><div className={`metric-icon ${item.color}`}><item.icon size={17} /></div><div><span>{item.label}</span><b>{item.value}</b><small>{item.note}</small></div></div>)}</div><div className="dashboard-columns"><div className="dashboard-main">{mapPanel({ title: 'Corridor traffic map', subtitle: 'Real streets shown when an OSM extract is available; otherwise labeled corridor-model links', route: routeResult })}{detailCard}<div className="source-card"><div className="source-card-icon"><Info size={16} /></div><div><b>Data provenance</b><p>{sourceLine} · Traffic: {trafficSource}. Traffic is treated as observed only when source records identify it as non-simulated.</p></div><button className="button button-quiet" onClick={() => setPage('analytics')}>View details <ArrowRight size={13} /></button></div><div className="dashboard-quick-actions"><button onClick={() => setPage('routes')}><Route size={16} /><span><b>Optimize a route</b><small>Dijkstra · A*</small></span><ArrowRight size={13} /></button><button onClick={() => setPage('incidents')}><Siren size={16} /><span><b>Report an incident</b><small>{activeIncidents.length} active reports</small></span><ArrowRight size={13} /></button><button onClick={() => setPage('sensors')}><Radio size={16} /><span><b>Plan sensor network</b><small>Prim · Kruskal</small></span><ArrowRight size={13} /></button></div></div><aside className="dashboard-aside"><section className="surface mini-route-panel"><div className="surface-head"><div><span className="panel-overline">TRAFFIC-AWARE ROUTE</span><h3>Silk Board ? Marathahalli</h3></div><Zap size={15} /></div>{routeCard(routeResult, true)}<button className="button button-primary button-wide" onClick={() => setPage('routes')}>Open route optimizer <ArrowRight size={14} /></button></section><section className="surface incident-mini"><div className="section-heading"><div><span className="panel-overline">INCIDENT DESK</span><h3>Recent reports</h3></div><button className="text-link" onClick={() => setPage('incidents')}>View all <ArrowRight size={12} /></button></div>{activeIncidents.length ? activeIncidents.slice(0, 4).map((incident) => <div className="incident-mini-row" key={incident.id}><span className={`severity-dot severity-${incident.severity}`} /><div><b>{incident.kind.replace('_', ' ')}</b><small>{incident.location_name} · {timeSince(incident.reported_at)}</small></div><span className={`severity-label severity-${incident.severity}`}>{incident.severity}</span></div>) : <div className="empty-hint"><CheckCircle2 size={15} />No active incidents reported.</div>}<button className="button button-quiet button-wide" onClick={() => setPage('incidents')}><Siren size={13} /> Open incident management</button></section><section className="surface source-mini"><div className="section-heading"><div><span className="panel-overline">OPERATIONS READINESS</span><h3>Feed and system status</h3></div><Radio size={15} /></div><div className="data-source-row"><span className="provider-mark osm">OSM</span><div><b>Road map</b><small>{network.sourceLabel}</small></div><span className="provider-state">{network.source === 'openstreetmap' ? 'LOADED' : 'MODEL'}</span></div><div className="data-source-row"><span className="provider-mark sim">API</span><div><b>Operations API</b><small>{apiOnline ? `${health?.database ?? 'Database'} · connected` : 'Offline · changes stay in this browser'}</small></div><span className={`provider-state ${apiOnline ? '' : 'provider-sim'}`}>{apiOnline ? 'READY' : 'OFFLINE'}</span></div><div className="data-source-row"><span className="provider-mark sim">TT</span><div><b>TomTom traffic</b><small>{health?.providers.tomtomTraffic.configured ? 'Key configured · no automatic polling' : 'Not configured · requires backend key'}</small></div><span className={`provider-state ${health?.providers.tomtomTraffic.configured ? '' : 'provider-sim'}`}>{health?.providers.tomtomTraffic.configured ? 'KEY SET' : 'SETUP'}</span></div><div className="data-source-row"><span className="provider-mark sim">G</span><div><b>Google Routes</b><small>{health?.providers.googleRoutes.configured ? (health.providers.selectedProvider === 'google_routes' ? 'Active · ETA comparison enabled' : 'Key set · select as active provider') : 'Not configured · requires backend key'}</small></div><span className={`provider-state ${health?.providers.googleRoutes.configured ? '' : 'provider-sim'}`}>{health?.providers.googleRoutes.configured && health.providers.selectedProvider === 'google_routes' ? 'ACTIVE' : health?.providers.googleRoutes.configured ? 'KEY SET' : 'SETUP'}</span></div><small className="last-update">Traffic in use: {network.traffic.filter((road) => !road.isSimulated).length} observed / {network.traffic.length} segments · updated {timeSince(dataUpdatedAt)}</small></section></aside></div></>;

  const incidentsPage = <div className="module-grid incident-grid"><div className="stack-column">{mapPanel({ title: 'Incident map · affected roads', subtitle: 'Active events and closures are highlighted on the corridor' })}{detailCard}<section className="surface"><div className="surface-head"><div><div className="surface-title"><AlertTriangle size={16} /><h2>Active and recent incidents</h2></div><p>Resolve an incident to reopen its road for route calculations.</p></div><span className="count-pill">{activeIncidents.length} ACTIVE</span></div><div className="incident-list">{incidents.length ? incidents.map((incident) => <article key={incident.id} className={`incident-row ${incident.status === 'resolved' ? 'incident-resolved' : ''}`}><div className={`incident-kind-icon severity-${incident.severity}`}><AlertCircle size={16} /></div><div className="incident-row-main"><div><b>{incident.kind.replace('_', ' ')}</b><span className={`severity-label severity-${incident.severity}`}>{incident.severity}</span><span className={`incident-status ${incident.status}`}>{incident.status}</span></div><small>{incident.location_name}{incident.road_id ? ` · ${incident.road_id}` : ''} · {timeSince(incident.reported_at)}</small><p>{incident.description}</p></div>{incident.status === 'active' && <button className="button button-quiet" disabled={!canOperate} onClick={() => resolveIncident(incident)}><CheckCircle2 size={13} /> Resolve</button>}</article>) : <div className="empty-state"><Shield size={24} /><b>All clear</b><span>No incidents reported in this session.</span></div>}</div></section></div><section className="surface form-surface"><div className="surface-head"><div><div className="surface-title"><Siren size={16} /><h2>Report an incident</h2></div><p>Reports are stored in the backend when available.</p></div></div><form className="panel-form" onSubmit={handleIncidentSubmit}><label className="form-field"><span>Incident type</span><select value={incidentKind} onChange={(event) => setIncidentKind(event.target.value)}><option value="accident">Road accident</option><option value="construction">Road construction</option><option value="waterlogging">Waterlogging</option><option value="breakdown">Broken-down vehicle</option><option value="closure">Road closure</option><option value="signal_failure">Traffic signal failure</option></select></label><label className="form-field"><span>Severity</span><select value={incidentSeverity} onChange={(event) => setIncidentSeverity(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>{locationSelect(incidentLocation, setIncidentLocation, 'Nearest junction')}<label className="form-field"><span>Affected road segment</span><select value={incidentRoadId} onChange={(event) => setIncidentRoadId(event.target.value)}><option value="">Not linked to a road</option>{network.traffic.map((road) => <option value={road.roadId} key={road.roadId}>{road.name} · {road.roadId}</option>)}</select></label><label className="form-field"><span>Description</span><textarea value={incidentDescription} onChange={(event) => setIncidentDescription(event.target.value)} placeholder="Describe what happened and any visible road impact…" rows={4} maxLength={500} /></label><div className="form-tip"><Info size={14} />Critical accidents and road closures block their linked segment in the route planner.</div><button className="button button-danger button-wide" disabled={!canOperate || incidentSaving}><Siren size={14} />{incidentSaving ? 'Submitting…' : 'Submit incident report'}</button>{!canOperate && <small className="form-tip-text">Viewer role cannot submit operator reports.</small>}</form></section></div>;

  const sensorPage = <div className="module-grid sensor-grid"><div className="stack-column">{mapPanel({ title: 'Sensor infrastructure · candidate connections', subtitle: 'Purple links show the selected minimum-cost sensor backbone', route: null, showSensors: true })}<section className="surface sensor-edge-table"><div className="surface-head"><div><div className="surface-title"><Network size={16} /><h2>Candidate sensor connections</h2></div><p>Disable an option to model a construction or access constraint.</p></div><span className="count-pill">{sensorConnections.filter((item) => item.connected).length} AVAILABLE</span></div><div className="sensor-connection-list">{sensorConnections.slice(0, 21).map((connection) => <label className="sensor-connection-row" key={connection.id}><input type="checkbox" checked={connection.connected} disabled={!canOperate} onChange={() => applySensorSites(sensorSites, sensorConnections.map((item) => item.id === connection.id ? { ...item, connected: !item.connected } : item))} /><span>{connection.a} ? {connection.b}</span><small>{(connection.distance_m / 1000).toFixed(1)} km</small><b>{money(connection.install_cost)}</b></label>)}</div></section></div><section className="surface sensor-config"><div className="surface-head"><div><div className="surface-title"><Radio size={16} /><h2>Sensor network planner</h2></div><p>Optimize monitoring connectivity, not driving routes.</p></div></div><div className="sensor-explainer"><Info size={15} /><span>An MST is the least-cost connected backbone for sensors. It does not calculate fastest road routes.</span></div><div className="panel-form"><div className="section-heading"><div><span className="panel-overline">CANDIDATE JUNCTIONS</span><p>Select where monitoring equipment could be placed.</p></div></div><div className="candidate-grid">{sensorSites.map((site) => <label className={`candidate-site ${site.candidate ? 'candidate-active' : ''}`} key={site.code}><input type="checkbox" checked={site.candidate} disabled={!canOperate || sensorSites.filter((item) => item.candidate).length <= 2 && site.candidate} onChange={() => applySensorSites(sensorSites.map((item) => item.id === site.id ? { ...item, candidate: !item.candidate } : item))} /><span>{site.code}</span><b>{site.name}</b></label>)}</div><div className="field-row"><label className="form-field"><span>MST algorithm</span><select value={sensorAlgorithm} onChange={(event) => setSensorAlgorithm(event.target.value as 'prim' | 'kruskal')}><option value="kruskal">Kruskal · Union–Find</option><option value="prim">Prim · grow from first site</option></select></label><label className="form-field"><span>Redundancy</span><select value={String(redundancy)} onChange={(event) => setRedundancy(event.target.value === 'true')}><option value="false">Minimum backbone</option><option value="true">Add backup links</option></select></label></div><label className="range-field"><span>Installation cost scenario <b>{costMultiplier.toFixed(1)}×</b></span><input type="range" min="0.5" max="2" step="0.1" value={costMultiplier} disabled={!canOperate} onChange={(event) => setCostMultiplier(Number(event.target.value))} /><small>Adjust modeled connection costs to explore budget sensitivity.</small></label>{sensorResult && <><div className="sensor-result-grid"><div><span>INSTALLATION</span><b>{money(sensorResult.totalInstallCost)}</b></div><div><span>YEARLY MAINTENANCE</span><b>{money(sensorResult.maintenanceCostYear)}</b></div><div><span>CONNECTED</span><b>{sensorResult.connectionCount} / {Math.max(0, sensorResult.siteCount - 1)} links</b></div><div><span>BACKUP LINKS</span><b>{sensorResult.redundantConnections.length}</b></div></div><div className="savings-banner"><div><span>ALL-CANDIDATE CONNECTIONS</span><b>{money(sensorResult.alternativeConnectionCost)}</b></div><ArrowRight size={15} /><div><span>BACKBONE SAVING</span><b>{money(sensorResult.savings)}</b></div></div><div className="algorithm-trace-list"><div className="section-heading"><b>{sensorAlgorithm === 'prim' ? 'Prim growth' : 'Kruskal edge decisions'}</b><span>{sensorStep}/{sensorResult.trace.length} steps</span></div>{sensorResult.trace.slice(0, sensorStep).map((item, index) => <div className={`algorithm-trace-row ${item.accepted ? 'trace-accepted' : 'trace-rejected'}`} key={`${item.edgeId}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><b>{sensorConnections.find((connection) => String(connection.id) === item.edgeId)?.a ?? item.edgeId} {item.accepted ? 'kept' : 'skipped'}</b><small>{item.reason}</small></div>)}<div className="trace-controls"><button className="button button-quiet" disabled={sensorStep <= 0} onClick={() => setSensorStep((n) => Math.max(0, n - 1))}>Previous step</button><button className="button button-primary" disabled={sensorStep >= sensorResult.trace.length} onClick={() => setSensorStep((n) => Math.min(sensorResult.trace.length, n + 1))}>Show next edge <ArrowRight size={13} /></button></div></div></>}</div></section></div>;

  const signalsPage = <div className="module-grid signal-grid"><section className="surface form-surface"><div className="surface-head"><div><div className="surface-title"><Signal size={16} /><h2>Junction queue assessment</h2></div><p>Enter observed or simulated queue conditions for an advisory score.</p></div></div><form className="panel-form" onSubmit={submitSignal}>{locationSelect(signalInput.junction_code, (value) => setSignalInput((current) => ({ ...current, junction_code: value, junction_name: locations.find((place) => place.id === value)?.name ?? value })), 'Junction')}{[['vehicle_count', 'Vehicle count', 0, 2000], ['average_wait_seconds', 'Average wait (seconds)', 0, 600], ['queue_length_m', 'Queue length (metres)', 0, 1000], ['cycle_duration_seconds', 'Current signal cycle (seconds)', 20, 300]].map(([key, label, min, max]) => <label className="form-field" key={key}><span>{label}</span><input type="number" min={Number(min)} max={Number(max)} value={signalInput[key as keyof SignalInput] as number} onChange={(event) => setSignalInput((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}<div className="form-tip"><Info size={14} />The recommendation is an educational model only. It cannot connect to or control Bengaluru signal systems.</div><button className="button button-primary button-wide" disabled={!canOperate || signalSaving}><Gauge size={15} />{signalSaving ? 'Analyzing…' : 'Analyze junction conditions'}</button></form></section><section className="surface signal-result"><div className="surface-head"><div><span className="panel-overline">SIGNAL TIMING ADVISOR</span><h2>{signalResult?.measurement.junction_name ?? signalInput.junction_name}</h2><p>Based on vehicle counts, waiting time, queue length and cycle.</p></div><span className={`severity-label severity-${signalResult?.level === 'critical' ? 'critical' : signalResult?.level === 'high' ? 'high' : 'medium'}`}>{signalResult?.level ?? 'pending'}</span></div>{signalResult ? <><div className="congestion-meter"><div className="meter-score"><strong>{signalResult.congestionScore}</strong><span>/ 100</span></div><div className="meter-bar"><i style={{ width: `${signalResult.congestionScore}%` }} /></div><small>Modeled congestion pressure score · {signalResult.source}</small></div><div className="timing-recommendation"><div><Timer size={18} /><span>Suggested cycle</span><b>{signalResult.recommendedCycleSeconds} sec</b></div><div><Activity size={18} /><span>Green phase estimate</span><b>{signalResult.suggestedGreenSeconds} sec</b></div></div><div className="recommendation-note"><Sparkles size={15} /><p>{signalResult.explanation} Review local engineering and safety standards before making any signal-timing changes.</p></div></> : <div className="empty-state">Enter junction measurements to calculate an advisory congestion score.</div>}</section></div>;

  const analyticsPage = <Suspense fallback={<div className="surface chart-loading">Loading traffic analytics…</div>}><AnalyticsDashboard analytics={analytics} network={network} route={routeResult} incidents={activeIncidents} sensor={sensorResult} /></Suspense>;

  const educationPage = <div className="education-page"><div className="welcome-row"><div><span className="eyebrow">GRAPH THEORY · TRAFFIC SYSTEMS</span><h2>Algorithm field guide</h2><p>Understand which graph problem each tool solves—and which it does not.</p></div><span className="simulation-status"><span className="status-dot" /> MODEL-BASED EXAMPLES</span></div><div className="education-grid">{[
    ['Weighted road graph', 'Vertices represent junctions. Edges represent road segments. Each edge has geometry, distance, direction rules and a travel-time estimate.', 'For example, a road segment can have a modeled weight of 4.2 minutes based on length and estimated speed.'],
    ['Dijkstra', 'Finds the lowest total non-negative edge cost from an origin. This prototype uses estimated travel time as the route cost by default.', 'The algorithm runs from the selected origin; the trace shows visited graph nodes and distance updates.'],
    ['A* pathfinding', 'Uses an admissible geographic heuristic to prioritize promising junctions while preserving shortest-path correctness.', 'Here the heuristic is straight-line distance scaled by the minimum edge cost per metre.'],
    ['Kruskal and Prim', 'Build a minimum spanning tree for sensor infrastructure. The cost is the modeled installation cost of each possible sensor link.', 'Both algorithms connect candidate sites for minimum total installation cost; optional backup links add redundancy.'],
    ['Rooted tree', 'A spanning tree can be oriented from any selected root. Parent, child, leaf and level describe the monitoring hierarchy.', 'Changing the root changes the hierarchy, not the underlying sensor backbone.'],
    ['Traffic provenance', 'OSM contributes road geometry, not traffic speed. Google Routes or TomTom data is only shown as provider-derived when a backend key is configured.', 'Without provider credentials, traffic is simulation or manual entry and is always labeled with its source.'],
  ].map(([title, body, example], index) => <article className="surface education-card" key={title}><span className="education-number">{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{body}</p><div><b>In this prototype</b><span>{example}</span></div></article>)}</div><div className="validation-strip"><div><CheckCircle2 size={17} /><span>Working algorithm checks</span></div>{['Dijkstra 17 min', 'MST 17', 'B-D closure 19 min', 'Root height 3'].map((item) => <span className="validation-chip" key={item}>{item}</span>)}</div></div>;

  const activeView = displayedPage === 'overview' ? overview : displayedPage === 'routes' ? routePanel : displayedPage === 'incidents' ? incidentsPage : displayedPage === 'sensors' ? sensorPage : displayedPage === 'signals' ? signalsPage : displayedPage === 'analytics' ? analyticsPage : educationPage;

  return <div className="smartflow-shell"><aside className={`smart-sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="smart-brand"><span className="smart-logo"><Activity size={19} /></span><div><b>SMARTFLOW</b><small>BENGALURU · TRAFFIC OPS</small></div><button className="sidebar-close icon-button" onClick={() => setMobileNav(false)}><X size={16} /></button></div><div className="sidebar-section-label">CONTROL SYSTEM</div>{['OPERATIONS', 'NETWORK DESIGN', 'INTELLIGENCE'].map((group) => <div className="nav-group" key={group}><span>{group}</span>{nav.filter((item) => item.group === group).map((item) => <button key={item.id} className={`smart-nav-item ${page === item.id ? 'nav-selected' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={16} /><span>{item.title}</span>{item.id === 'incidents' && activeIncidents.length > 0 && <i>{activeIncidents.length}</i>}</button>)}</div>)}<div className="sidebar-grow" /><div className="sidebar-api-state"><div className={`api-state-light ${apiOnline ? 'api-ok' : ''}`} /><div><b>{apiOnline ? 'Backend connected' : 'Offline demo mode'}</b><small>{apiOnline ? 'Django REST · local API' : 'Local fallback · start Django API'}</small></div><button onClick={() => loadNetwork()} title="Retry backend connection"><RefreshCw size={13} /></button></div><div className="sidebar-foot"><b>SMART CITY LEARNING SIMULATION</b><span>Graph Theory · Bengaluru corridor</span></div></aside>{mobileNav && <button className="sidebar-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="smart-main">{header}<div className="content-area"><div className="data-ribbon"><span><MapPinned size={13} /> MAP DATA · {network.sourceLabel}</span><i /><span><Radio size={13} /> TRAFFIC · {trafficSource}</span><i /><span><Clock3 size={13} /> UPDATED · {timeSince(dataUpdatedAt)}</span><div className="data-ribbon-right">{sourceLine}</div></div>{network.refreshError && <div className="message-banner"><Info size={14} />{network.refreshError}</div>}{activeView}{page !== 'overview' && <div className="global-simulation-note"><Info size={13} /> Data source is shown per observation. Simulation inputs are not live traffic measurements. OSM road geometry is separate from traffic data.</div>}<footer className="smart-footer"><span>SMARTFLOW BENGALURU · PROTOTYPE</span><span>Academic simulation · no real signal control</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></footer></div></main>{message && <div className="toast-message"><CheckCircle2 size={16} />{message}</div>}
    {presentation && <PresentationModal page={presentationSlide} network={network} route={presentationSlide === 2 ? routeResult : null} incidents={incidents} sensors={sensorResult} sensorSites={sensorSites} showSensors={presentationSlide === 3 || presentationSlide === 4} onNext={() => setPresentationSlide((value) => Math.min(7, value + 1))} onBack={() => setPresentationSlide((value) => Math.max(0, value - 1))} onClose={() => setPresentation(false)} />}
  </div>;
}

function PresentationModal({ page, network, route, incidents, sensors, sensorSites, showSensors, onNext, onBack, onClose }: { page: number; network: NetworkData; route: RouteResult | null; incidents: Incident[]; sensors: SensorResult | null; sensorSites: SensorSite[]; showSensors: boolean; onNext: () => void; onBack: () => void; onClose: () => void }) {
  const agenda = [
    ['Introduction', 'A Bengaluru traffic management simulation built around graph theory. Road geometry is from OpenStreetMap when loaded; traffic is separately sourced or simulated.'],
    ['Road network', 'Inspect named corridor junctions and road geometry on an interactive Leaflet map. Click segments to review their data provenance.'],
    ['Route optimization', 'Compare Dijkstra and A* under fastest-time and shortest-distance objectives. Disruptions are excluded from route calculations.'],
    ['Kruskal sensor backbone', 'Kruskal uses installation cost and Union–Find to choose a minimum-cost connected sensor network.'],
    ['Prim sensor backbone', 'Prim independently grows a minimum spanning tree from a selected candidate junction.'],
    ['Incidents', 'Report and resolve road incidents. A closure changes the network and triggers a new route calculation.'],
    ['Analytics', 'Review modeled congestion, route delay, incidents, provider availability and sensor cost.'],
    ['Conclusion', 'Shortest-path routing and minimum-cost infrastructure planning are different graph problems.'],
  ];
  return <div className="briefing-backdrop"><div className="briefing-modal"><header><div className="smart-brand"><span className="smart-logo"><Activity size={18} /></span><div><b>SMARTFLOW</b><small>OPERATOR BRIEFING</small></div></div><div className="briefing-progress">{agenda.map((_, index) => <i key={index} className={index <= page ? 'progress-done' : ''} />)}</div><button className="icon-button" onClick={onClose}><X size={17} /></button></header><div className="briefing-body"><div><span className="eyebrow">PROJECT OVERVIEW · {String(page + 1).padStart(2, '0')} / 08</span><h2>{agenda[page][0]}</h2><p>{agenda[page][1]}</p><div className="briefing-tags"><span>7 corridor junctions</span><span>Local graph algorithms</span><span>Simulation mode</span></div><div className="briefing-controls"><button className="button button-quiet" disabled={page === 0} onClick={onBack}>? Previous</button><button className="button button-primary" onClick={page === 7 ? onClose : onNext}>{page === 7 ? 'Finish briefing' : 'Continue'} <ArrowRight size={14} /></button></div></div><div className="briefing-map"><TrafficMap network={network} route={route?.segments ?? []} incidents={incidents} sensors={showSensors ? sensors : null} sensorSites={sensorSites} showSensors={showSensors} compact /><div className="briefing-map-source">© OpenStreetMap contributors · {network.sourceLabel}</div></div></div></div></div>;
}

export default App;
