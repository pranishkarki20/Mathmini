import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, BarChart3,
  CheckCircle2, ChevronDown, Clock3, CloudDownload, Gauge,
  Info, MapPinned, Menu, Network, Radio,
  RefreshCw, Route, Shield, Signal, Siren, SlidersHorizontal,
  Sparkles, Timer, Users, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import TrafficMap from './components/TrafficMap';
import RoutePlanner from './components/RoutePlanner';
import RoadNetworkExplorer from './components/RoadNetworkExplorer';
import { api, ApiError, localFallbackNetwork, type AnalyticsData, type HealthData, type Incident, type NetworkData, type RouteResult, type SensorConnection, type SensorResult, type SensorSite, type SignalInput, type SignalResult, type TrafficRoad } from './api';
import { locations, nodeIds, type NodeId } from './data/network';

const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));

type Page = 'overview' | 'routes' | 'network' | 'incidents' | 'sensors' | 'signals' | 'analytics';
type Role = 'Administrator' | 'Traffic operator' | 'Viewer';
const nav: { id: Page; title: string; icon: LucideIcon; group: string }[] = [
  { id: 'overview', title: 'Control centre', icon: Activity, group: 'OPERATIONS' },
  { id: 'routes', title: 'Route planner', icon: Route, group: 'OPERATIONS' },
  { id: 'network', title: 'Road network analysis', icon: Network, group: 'OPERATIONS' },
  { id: 'incidents', title: 'Incidents & closures', icon: Siren, group: 'OPERATIONS' },
  { id: 'sensors', title: 'Sensor infrastructure', icon: Radio, group: 'NETWORK DESIGN' },
  { id: 'signals', title: 'Signal analysis', icon: Signal, group: 'NETWORK DESIGN' },
  { id: 'analytics', title: 'Traffic analytics', icon: BarChart3, group: 'INTELLIGENCE' },
];
const initialSignal: SignalInput = { junction_code: 'D', junction_name: 'Ibbaluru', vehicle_count: 75, average_wait_seconds: 55, queue_length_m: 70, cycle_duration_seconds: 90 };
const conditionColors: Record<string, string> = { normal: '#38c997', moderate: '#e9ce58', heavy: '#ef9f4a', severe: '#eb6571', closed: '#7d8999', simulated: '#58bbd4', unobserved: '#72819a' };

function money(value: number | string) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0); }
function numberLabel(value: number) { return new Intl.NumberFormat('en-IN').format(value); }
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
  const [page, setPage] = useState<Page>('routes');
  const [network, setNetwork] = useState<NetworkData>(() => localFallbackNetwork());
  const [apiOnline, setApiOnline] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loadingNetwork, setLoadingNetwork] = useState(true);
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<Role>('Traffic operator');
  const [mobileNav, setMobileNav] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedRoad, setSelectedRoad] = useState<TrafficRoad | null>(null);
  const [mapFilters, setMapFilters] = useState<string[]>([]);
  const [incidentKind, setIncidentKind] = useState('accident');
  const [incidentSeverity, setIncidentSeverity] = useState('medium');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [incidentLocation, setIncidentLocation] = useState<NodeId>('D');
  const [incidentRoadId, setIncidentRoadId] = useState('');
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [sensorSites, setSensorSites] = useState<SensorSite[]>([]);
  const [sensorConnections, setSensorConnections] = useState<SensorConnection[]>([]);
  const [sensorResult, setSensorResult] = useState<SensorResult | null>(null);
  const [redundancy, setRedundancy] = useState(false);
  const [costMultiplier, setCostMultiplier] = useState(1);
  const [signalInput, setSignalInput] = useState<SignalInput>(initialSignal);
  const [signalResult, setSignalResult] = useState<SignalResult | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [signalSaving, setSignalSaving] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [trafficSource, setTrafficSource] = useState('Simulation · modeled baseline');

  const canOperate = role !== 'Viewer';
  const currentPage = nav.find((item) => item.id === page)?.title ?? 'Control centre';
  const dataUpdatedAt = network.updatedAt;
  const activeIncidents = incidents.filter((incident) => incident.status === 'active');
  const closures = activeIncidents.filter((incident) => incident.kind === 'closure' || (incident.kind === 'accident' && incident.severity === 'critical')).map((incident) => incident.road_id).filter(Boolean);
  const blockedRoadCount = new Set([...closures, ...network.traffic.filter((road) => road.closed).map((road) => road.roadId)]).size;
  const selectedFeature = selectedRoad;
  const displayedPage = page;

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
    Promise.allSettled([api.network(), api.health(), api.sensors(), api.signals(), api.analytics(), api.incidents()]).then((results) => {
      if (cancelled) return;
      const [networkResult, healthResult, sensorResult, signalResult, analyticsResult, incidentResult] = results;
      if (networkResult.status === 'fulfilled') { setNetwork(networkResult.value); setIncidents(networkResult.value.incidents); }
      if (healthResult.status === 'fulfilled') { setApiOnline(true); setHealth(healthResult.value); }
      if (sensorResult.status === 'fulfilled') { setSensorSites(sensorResult.value.sites); setSensorConnections(sensorResult.value.connections); }
      else { const local = localSensors(network); setSensorSites(local.sites); setSensorConnections(local.connections); }
      if (signalResult.status === 'fulfilled') { setSignalResult(signalResult.value); setSignalInput(signalResult.value.measurement); }
      if (analyticsResult.status === 'fulfilled') setAnalytics(analyticsResult.value);
      if (incidentResult.status === 'fulfilled') setIncidents(incidentResult.value);
      if (networkResult.status === 'rejected' && healthResult.status === 'rejected') setApiOnline(false);
      setLoadingNetwork(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!apiOnline) return;
    api.analytics().then(setAnalytics).catch(() => undefined);
  }, [apiOnline, incidents, network]);

  useEffect(() => {
    if (!sensorSites.length) return;
    let cancelled = false;
    api.optimizeSensors('kruskal', redundancy, costMultiplier).then((result) => { if (!cancelled) setSensorResult(result); }).catch(() => {
      if (!cancelled) setSensorResult(localSensorOptimize(sensorSites, sensorConnections, 'kruskal', redundancy, costMultiplier));
    });
    return () => { cancelled = true; };
  }, [redundancy, costMultiplier, sensorSites, sensorConnections]);


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
    } catch { const report = { generatedAt: new Date().toISOString(), trafficSource, networkSource: network.sourceLabel, route: null, incidents, analytics, sensorResult, note: 'Simulation/manual measurements only; this report contains no live traffic feed.' }; const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); link.download = `smartflow-simulation-report-${new Date().toISOString().slice(0, 10)}.json`; link.click(); announce('Local simulation report exported as JSON.'); }
    finally { setReportLoading(false); }
  };

  const refreshOsm = async () => { announce('Requesting a fresh OSM road extract from Overpass…'); const data = await loadNetwork(true); if (data?.source === 'openstreetmap') announce(`Loaded ${data.geojson.features.length.toLocaleString()} OpenStreetMap road features.`); else if (data) announce('OSM extract is unavailable. The explicitly labeled corridor model remains active.'); };
  const useJunction = (code: string) => { if (page === 'incidents' && nodeIds.includes(code as NodeId)) { setIncidentLocation(code as NodeId); announce(`${code} selected as the incident location.`); } };
  const toggleFilter = (value: string) => setMapFilters((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const selectRoad = (road: TrafficRoad) => { setSelectedRoad(road); setIncidentRoadId(road.roadId); };

  const sourceLine = <span className={`source-status ${network.source === 'openstreetmap' ? 'source-live' : 'source-sim'}`}><i />{network.sourceLabel}</span>;
  const header = <header className="command-header"><div className="command-title"><button className="mobile-nav-button icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={18} /></button><div><div className="crumb">SMARTFLOW <span>/</span> {currentPage.toUpperCase()}</div><h1>{page === 'overview' ? 'Traffic control centre' : currentPage}</h1></div></div><div className="header-controls"><div className="simulation-status"><span className="status-dot" /> {page === 'routes' ? 'OSRM ROUTE PLANNER' : network.traffic.some((road) => !road.isSimulated) ? 'OBSERVED DATA' : 'SIMULATION MODE'}</div><label className="role-select"><Users size={13} /><select value={role} onChange={(event) => setRole(event.target.value as Role)} aria-label="Demo role display" title="Presentation control only. Django enforces permissions for API writes."><option>Administrator</option><option>Traffic operator</option><option>Viewer</option></select><ChevronDown size={12} /></label><button className="button button-export" disabled={reportLoading} onClick={exportReport}>{reportLoading ? <RefreshCw className="spin" size={14} /> : <CloudDownload size={14} />} Export report</button></div></header>;

  const locationSelect = (value: string, setValue: (value: NodeId) => void, label: string) => <label className="form-field"><span>{label}</span><select value={value} onChange={(event) => setValue(event.target.value as NodeId)}>{locations.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label>;

  const mapPanel = (props: { title?: string; subtitle?: string; route?: RouteResult | null; showSensors?: boolean; compact?: boolean }) => <section className="surface map-card"><div className="surface-head"><div><div className="surface-title"><MapPinned size={16} /><h2>{props.title ?? 'Bengaluru corridor · road network'}</h2><span className="map-real-pill">{network.source === 'openstreetmap' ? 'REAL ROAD GEOMETRY' : 'MODEL CONNECTORS'}</span></div><p>{props.subtitle ?? 'Silk Board · Agara · HSR Layout · Ibbaluru · Bellandur · Marathahalli'}</p></div><div className="map-actions"><button className="button button-quiet" onClick={refreshOsm} disabled={loadingNetwork}><RefreshCw size={13} className={loadingNetwork ? 'spin' : ''} /> Refresh OSM</button><button className="icon-button" onClick={() => setMapFilters([])} title="Clear map filters"><SlidersHorizontal size={14} /></button></div></div><div className="map-filter-bar">{[['normal', 'Normal'], ['moderate', 'Moderate'], ['heavy', 'Heavy'], ['severe', 'Severe'], ['closed', 'Closed']].map(([id, label]) => <button key={id} className={`filter-chip ${mapFilters.includes(id) ? 'filter-selected' : ''}`} onClick={() => toggleFilter(id)}><i style={{ background: conditionColors[id] }} />{label}</button>)}<span className="filter-divider" /><span className="map-traffic-source">{trafficSource}</span></div><TrafficMap network={network} route={props.route?.segments ?? []} incidents={incidents} sensors={props.showSensors ? sensorResult : null} sensorSites={sensorSites} selectedRoad={selectedRoad} onRoadSelect={selectRoad} onJunctionSelect={useJunction} filterConditions={mapFilters} showSensors={props.showSensors} compact={props.compact} /></section>;

  const routePanel = <RoutePlanner />;

  const detailCard = selectedFeature && <div className="road-detail-card"><div className="road-detail-heading"><div><span className="panel-overline">SELECTED ROAD</span><strong>{selectedFeature.name}</strong></div><button className="icon-button" onClick={() => setSelectedRoad(null)} aria-label="Close road details"><X size={14} /></button></div><div className="road-detail-metrics"><div><span>Mapped distance</span><b>{(selectedFeature.distanceM / 1000).toFixed(2)} km</b></div><div><span>Road status</span><b>{selectedFeature.closed ? 'Closed' : selectedFeature.condition}</b></div></div><div className="detail-source">Map source: {selectedFeature.source}. No live traffic speed is inferred from this road geometry.</div></div>;
  const overview = <><div className="welcome-row"><div><span className="eyebrow">BENGALURU · OUTER RING ROAD CORRIDOR</span><h2>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, operator</h2><p>Monitor corridor conditions, model incidents, and plan a resilient sensor backbone.</p></div></div><div className="metric-grid">{[
    { label: 'Road segments', value: numberLabel(network.traffic.length), note: network.source === 'openstreetmap' ? 'OpenStreetMap corridor' : 'Study corridor model', icon: MapPinned, color: 'blue' },
    { label: 'Active incidents', value: activeIncidents.length, note: `${blockedRoadCount} blocked roads`, icon: Siren, color: activeIncidents.length ? 'red' : 'green' },
    { label: 'Route planning', value: 'Ready', note: 'Search any mapped location', icon: Route, color: 'cyan' },
    { label: 'Sensor backbone', value: sensorResult ? money(sensorResult.totalInstallCost) : '—', note: sensorResult?.connected ? `${sensorResult.connectionCount} connections · /` : 'Optimize candidate sensors', icon: Radio, color: 'amber' },
  ].map((item) => <div className="metric-card" key={item.label}><div className={`metric-icon ${item.color}`}><item.icon size={17} /></div><div><span>{item.label}</span><b>{item.value}</b><small>{item.note}</small></div></div>)}</div><div className="dashboard-columns"><div className="dashboard-main">{mapPanel({ title: 'Road network overview', subtitle: 'Current map coverage and reported conditions; traffic data is identified by source', route: null })}{detailCard}<div className="source-card"><div className="source-card-icon"><Info size={16} /></div><div><b>Data provenance</b><p>{sourceLine} · Traffic: {trafficSource}. Traffic is treated as observed only when source records identify it as non-simulated.</p></div><button className="button button-quiet" onClick={() => setPage('analytics')}>View details <ArrowRight size={13} /></button></div><div className="dashboard-quick-actions"><button onClick={() => setPage('routes')}><Route size={16} /><span><b>Optimize a route</b><small> · A*</small></span><ArrowRight size={13} /></button><button onClick={() => setPage('incidents')}><Siren size={16} /><span><b>Report an incident</b><small>{activeIncidents.length} active reports</small></span><ArrowRight size={13} /></button><button onClick={() => setPage('sensors')}><Radio size={16} /><span><b>Plan sensor network</b><small> · </small></span><ArrowRight size={13} /></button></div></div><aside className="dashboard-aside"><section className="surface mini-route-panel"><div className="surface-head"><div><span className="panel-overline">ROUTE PLANNING</span><h3>Any origin to destination</h3></div><Zap size={15} /></div>{<p className="empty-hint">Search any locations in Route planner to calculate a journey.</p>}<button className="button button-primary button-wide" onClick={() => setPage('routes')}>Open route optimizer <ArrowRight size={14} /></button></section><section className="surface incident-mini"><div className="section-heading"><div><span className="panel-overline">INCIDENT DESK</span><h3>Recent reports</h3></div><button className="text-link" onClick={() => setPage('incidents')}>View all <ArrowRight size={12} /></button></div>{activeIncidents.length ? activeIncidents.slice(0, 4).map((incident) => <div className="incident-mini-row" key={incident.id}><span className={`severity-dot severity-${incident.severity}`} /><div><b>{incident.kind.replace('_', ' ')}</b><small>{incident.location_name} · {timeSince(incident.reported_at)}</small></div><span className={`severity-label severity-${incident.severity}`}>{incident.severity}</span></div>) : <div className="empty-hint"><CheckCircle2 size={15} />No active incidents reported.</div>}<button className="button button-quiet button-wide" onClick={() => setPage('incidents')}><Siren size={13} /> Open incident management</button></section><section className="surface source-mini"><div className="section-heading"><div><span className="panel-overline">OPERATIONS READINESS</span><h3>Map and routing services</h3></div><MapPinned size={15} /></div><div className="data-source-row"><span className="provider-mark osm">OSM</span><div><b>Road map</b><small>{network.sourceLabel}</small></div><span className="provider-state">{network.source === 'openstreetmap' ? 'LOADED' : 'MODEL'}</span></div><div className="data-source-row"><span className="provider-mark sim">API</span><div><b>Operations API</b><small>{apiOnline ? `${health?.database ?? 'Database'} · connected` : 'Offline · local demo data'}</small></div><span className={`provider-state ${apiOnline ? '' : 'provider-sim'}`}>{apiOnline ? 'READY' : 'OFFLINE'}</span></div><div className="data-source-row"><span className="provider-mark sim">N</span><div><b>Place search</b><small>Nominatim · submit-to-search, cached and rate-limited</small></div><span className="provider-state">OSM</span></div><div className="data-source-row"><span className="provider-mark sim">R</span><div><b>Route estimates</b><small>{health?.providers.routing.endpoint ?? 'OSRM endpoint not reported'}</small></div><span className="provider-state">OSRM</span></div><div className="data-source-row"><span className="provider-mark sim">T</span><div><b>Live traffic</b><small>No live traffic source is configured</small></div><span className="provider-state provider-sim">OFF</span></div><small className="last-update">Current conditions are not inferred from road geometry.</small></section></aside></div></>;

  const incidentsPage = <div className="module-grid incident-grid"><div className="stack-column">{mapPanel({ title: 'Incident map · affected roads', subtitle: 'Active events and closures are highlighted on the corridor' })}{detailCard}<section className="surface"><div className="surface-head"><div><div className="surface-title"><AlertTriangle size={16} /><h2>Active and recent incidents</h2></div><p>Resolve an incident to reopen its road for route calculations.</p></div><span className="count-pill">{activeIncidents.length} ACTIVE</span></div><div className="incident-list">{incidents.length ? incidents.map((incident) => <article key={incident.id} className={`incident-row ${incident.status === 'resolved' ? 'incident-resolved' : ''}`}><div className={`incident-kind-icon severity-${incident.severity}`}><AlertCircle size={16} /></div><div className="incident-row-main"><div><b>{incident.kind.replace('_', ' ')}</b><span className={`severity-label severity-${incident.severity}`}>{incident.severity}</span><span className={`incident-status ${incident.status}`}>{incident.status}</span></div><small>{incident.location_name}{incident.road_id ? ` · ${incident.road_id}` : ''} · {timeSince(incident.reported_at)}</small><p>{incident.description}</p></div>{incident.status === 'active' && <button className="button button-quiet" disabled={!canOperate} onClick={() => resolveIncident(incident)}><CheckCircle2 size={13} /> Resolve</button>}</article>) : <div className="empty-state"><Shield size={24} /><b>All clear</b><span>No incidents reported in this session.</span></div>}</div></section></div><section className="surface form-surface"><div className="surface-head"><div><div className="surface-title"><Siren size={16} /><h2>Report an incident</h2></div><p>Reports are stored in the backend when available.</p></div></div><form className="panel-form" onSubmit={handleIncidentSubmit}><label className="form-field"><span>Incident type</span><select value={incidentKind} onChange={(event) => setIncidentKind(event.target.value)}><option value="accident">Road accident</option><option value="construction">Road construction</option><option value="waterlogging">Waterlogging</option><option value="breakdown">Broken-down vehicle</option><option value="closure">Road closure</option><option value="signal_failure">Traffic signal failure</option></select></label><label className="form-field"><span>Severity</span><select value={incidentSeverity} onChange={(event) => setIncidentSeverity(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>{locationSelect(incidentLocation, setIncidentLocation, 'Nearest junction')}<label className="form-field"><span>Affected road segment</span><select value={incidentRoadId} onChange={(event) => setIncidentRoadId(event.target.value)}><option value="">Not linked to a road</option>{network.traffic.map((road) => <option value={road.roadId} key={road.roadId}>{road.name} · {road.roadId}</option>)}</select></label><label className="form-field"><span>Description</span><textarea value={incidentDescription} onChange={(event) => setIncidentDescription(event.target.value)} placeholder="Describe what happened and any visible road impact…" rows={4} maxLength={500} /></label><div className="form-tip"><Info size={14} />Critical accidents and road closures block their linked segment in the route planner.</div><button className="button button-danger button-wide" disabled={!canOperate || incidentSaving}><Siren size={14} />{incidentSaving ? 'Submitting…' : 'Submit incident report'}</button>{!canOperate && <small className="form-tip-text">Viewer role cannot submit operator reports.</small>}</form></section></div>;

  const sensorPage = <div className="module-grid sensor-grid"><div className="stack-column">{mapPanel({ title: 'Sensor infrastructure ? candidate connections', subtitle: 'Recommended links between monitoring sites', route: null, showSensors: true })}<section className="surface sensor-edge-table"><div className="surface-head"><div><div className="surface-title"><Network size={16} /><h2>Candidate connections</h2></div><p>Clear a checkbox to model a blocked installation corridor.</p></div><span className="count-pill">{sensorConnections.filter((item) => item.connected).length} AVAILABLE</span></div><div className="sensor-connection-list">{sensorConnections.slice(0, 21).map((connection) => <label className="sensor-connection-row" key={connection.id}><input type="checkbox" checked={connection.connected} disabled={!canOperate} onChange={() => applySensorSites(sensorSites, sensorConnections.map((item) => item.id === connection.id ? { ...item, connected: !item.connected } : item))} /><span>{connection.a} ? {connection.b}</span><small>{(connection.distance_m / 1000).toFixed(1)} km</small><b>{money(connection.install_cost)}</b></label>)}</div></section></div><section className="surface sensor-config"><div className="surface-head"><div><div className="surface-title"><Radio size={16} /><h2>Monitoring connection plan</h2></div><p>Choose candidate locations and review the estimated installation budget.</p></div></div><div className="panel-form"><div className="section-heading"><div><span className="panel-overline">CANDIDATE JUNCTIONS</span><p>Select locations for proposed monitoring equipment.</p></div></div><div className="candidate-grid">{sensorSites.map((site) => <label className={`candidate-site ${site.candidate ? 'candidate-active' : ''}`} key={site.code}><input type="checkbox" checked={site.candidate} disabled={!canOperate || sensorSites.filter((item) => item.candidate).length <= 2 && site.candidate} onChange={() => applySensorSites(sensorSites.map((item) => item.id === site.id ? { ...item, candidate: !item.candidate } : item))} /><span>{site.code}</span><b>{site.name}</b></label>)}</div><div className="field-row"><label className="form-field"><span>Backup connections</span><select value={String(redundancy)} onChange={(event) => setRedundancy(event.target.value === 'true')}><option value="false">Minimum connected plan</option><option value="true">Include backup links</option></select></label><label className="form-field"><span>Installation cost scenario</span><select value={String(costMultiplier)} onChange={(event) => setCostMultiplier(Number(event.target.value))}><option value="0.8">Lower estimate ? 0.8?</option><option value="1">Baseline estimate ? 1.0?</option><option value="1.2">Higher estimate ? 1.2?</option><option value="1.5">High estimate ? 1.5?</option></select></label></div><small className="form-tip"><Info size={14} />Costs are modeled estimates. Replace them with site survey and procurement quotes before budgeting.</small>{sensorResult && <><div className="sensor-result-grid"><div><span>INSTALLATION ESTIMATE</span><b>{money(sensorResult.totalInstallCost)}</b></div><div><span>YEARLY MAINTENANCE</span><b>{money(sensorResult.maintenanceCostYear)}</b></div><div><span>CONNECTED SITES</span><b>{sensorResult.connected ? `${sensorResult.siteCount} sites` : 'Not fully connected'}</b></div><div><span>SELECTED LINKS</span><b>{sensorResult.connectionCount}</b></div></div><div className="sensor-connection-list">{sensorResult.edges.map((edge) => <div className="sensor-connection-row" key={edge.id}><span>{edge.a} ? {edge.b}</span><small>{(edge.distanceM / 1000).toFixed(1)} km</small><b>{money(edge.installCost)}</b></div>)}</div><small className="last-update">{sensorResult.dataSource ?? 'Modeled installation cost estimates'}</small></>}</div></section></div>;

  const signalsPage = <div className="module-grid signal-grid"><section className="surface form-surface"><div className="surface-head"><div><div className="surface-title"><Signal size={16} /><h2>Junction queue assessment</h2></div><p>Enter observed or simulated queue conditions for an advisory score.</p></div></div><form className="panel-form" onSubmit={submitSignal}>{locationSelect(signalInput.junction_code, (value) => setSignalInput((current) => ({ ...current, junction_code: value, junction_name: locations.find((place) => place.id === value)?.name ?? value })), 'Junction')}{[['vehicle_count', 'Vehicle count', 0, 2000], ['average_wait_seconds', 'Average wait (seconds)', 0, 600], ['queue_length_m', 'Queue length (metres)', 0, 1000], ['cycle_duration_seconds', 'Current signal cycle (seconds)', 20, 300]].map(([key, label, min, max]) => <label className="form-field" key={key}><span>{label}</span><input type="number" min={Number(min)} max={Number(max)} value={signalInput[key as keyof SignalInput] as number} onChange={(event) => setSignalInput((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}<div className="form-tip"><Info size={14} />Advisory estimate from entered values only. It does not connect to or control real signal systems.</div><button className="button button-primary button-wide" disabled={!canOperate || signalSaving}><Gauge size={15} />{signalSaving ? 'Analyzing…' : 'Analyze junction conditions'}</button></form></section><section className="surface signal-result"><div className="surface-head"><div><span className="panel-overline">SIGNAL TIMING ADVISOR</span><h2>{signalResult?.measurement.junction_name ?? signalInput.junction_name}</h2><p>Based on vehicle counts, waiting time, queue length and cycle.</p></div><span className={`severity-label severity-${signalResult?.level === 'critical' ? 'critical' : signalResult?.level === 'high' ? 'high' : 'medium'}`}>{signalResult?.level ?? 'pending'}</span></div>{signalResult ? <><div className="congestion-meter"><div className="meter-score"><strong>{signalResult.congestionScore}</strong><span>/ 100</span></div><div className="meter-bar"><i style={{ width: `${signalResult.congestionScore}%` }} /></div><small>Modeled congestion pressure score · {signalResult.source}</small></div><div className="timing-recommendation"><div><Timer size={18} /><span>Suggested cycle</span><b>{signalResult.recommendedCycleSeconds} sec</b></div><div><Activity size={18} /><span>Green phase estimate</span><b>{signalResult.suggestedGreenSeconds} sec</b></div></div><div className="recommendation-note"><Sparkles size={15} /><p>{signalResult.explanation} Review local engineering and safety standards before making any signal-timing changes.</p></div></> : <div className="empty-state">Enter junction measurements to calculate an advisory congestion score.</div>}</section></div>;

  const analyticsPage = <Suspense fallback={<div className="surface chart-loading">Loading traffic analytics…</div>}><AnalyticsDashboard analytics={analytics} network={network} incidents={activeIncidents} sensor={sensorResult} /></Suspense>;

  const activeView = displayedPage === 'overview' ? overview : displayedPage === 'routes' ? routePanel : displayedPage === 'network' ? <RoadNetworkExplorer /> : displayedPage === 'incidents' ? incidentsPage : displayedPage === 'sensors' ? sensorPage : displayedPage === 'signals' ? signalsPage : analyticsPage;

  return <div className="smartflow-shell"><aside className={`smart-sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="smart-brand"><span className="smart-logo"><Activity size={19} /></span><div><b>SMARTFLOW</b><small>BENGALURU · TRAFFIC OPS</small></div><button className="sidebar-close icon-button" onClick={() => setMobileNav(false)}><X size={16} /></button></div><div className="sidebar-section-label">CONTROL SYSTEM</div>{['OPERATIONS', 'NETWORK DESIGN', 'INTELLIGENCE'].map((group) => <div className="nav-group" key={group}><span>{group}</span>{nav.filter((item) => item.group === group).map((item) => <button key={item.id} className={`smart-nav-item ${page === item.id ? 'nav-selected' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={16} /><span>{item.title}</span>{item.id === 'incidents' && activeIncidents.length > 0 && <i>{activeIncidents.length}</i>}</button>)}</div>)}<div className="sidebar-grow" /><div className="sidebar-api-state"><div className={`api-state-light ${apiOnline ? 'api-ok' : ''}`} /><div><b>{apiOnline ? 'Backend connected' : 'Offline demo mode'}</b><small>{apiOnline ? 'Django REST · local API' : 'Local fallback · start Django API'}</small></div><button onClick={() => loadNetwork()} title="Retry backend connection"><RefreshCw size={13} /></button></div><div className="sidebar-foot"><b>SMART CITY OPERATIONS</b><span>Graph Theory · Bengaluru corridor</span></div></aside>{mobileNav && <button className="sidebar-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="smart-main">{header}<div className="content-area">{page !== 'routes' && (<div className="data-ribbon"><span><MapPinned size={13} /> MAP DATA · {network.sourceLabel}</span><i /><span><Radio size={13} /> TRAFFIC · {trafficSource}</span><i /><span><Clock3 size={13} /> UPDATED · {timeSince(dataUpdatedAt)}</span><div className="data-ribbon-right">{sourceLine}</div></div>)}{network.refreshError && <div className="message-banner"><Info size={14} />{network.refreshError}</div>}{activeView}{page !== 'overview' && page !== 'routes' && <div className="global-simulation-note"><Info size={13} /> Data source is shown per observation. Simulation inputs are not live traffic measurements. OSM road geometry is separate from traffic data.</div>}<footer className="smart-footer"><span>SMARTFLOW BENGALURU · PROTOTYPE</span><span>Academic simulation · no real signal control</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></footer></div></main>{message && <div className="toast-message"><CheckCircle2 size={16} />{message}</div>}

  </div>;
}

export default App;
