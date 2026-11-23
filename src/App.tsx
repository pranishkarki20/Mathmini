import { useCallback, useEffect, useState } from 'react';
import { Activity, BarChart3, MapPinned, Menu, Network, Radio, RefreshCw, Route, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import RoutePlanner from './components/RoutePlanner';
import RoadNetworkExplorer from './components/RoadNetworkExplorer';
import SensorInfrastructure from './components/SensorInfrastructure';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import { api, localFallbackNetwork, type AreaNetworkData, type NetworkData } from './api';

type Page = 'overview' | 'routes' | 'network' | 'sensors' | 'analytics';
const nav: { id: Page; title: string; icon: LucideIcon; group: string }[] = [
  { id: 'overview', title: 'Dashboard', icon: Activity, group: 'PLATFORM' },
  { id: 'network', title: 'Road network analysis', icon: Network, group: 'PLATFORM' },
  { id: 'routes', title: 'Route planner', icon: Route, group: 'PLATFORM' },
  { id: 'sensors', title: 'Sensor infrastructure', icon: Radio, group: 'PLANNING' },
  { id: 'analytics', title: 'Network analytics', icon: BarChart3, group: 'INSIGHTS' },
];

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [network, setNetwork] = useState<NetworkData>(localFallbackNetwork);
  const [selectedArea, setSelectedArea] = useState<AreaNetworkData | null>(null);
  const [selectedAreaName, setSelectedAreaName] = useState('');
  const [sensorSummary, setSensorSummary] = useState({ count: 0, investment: 0, currency: 'INR' });
  const [recentActivity, setRecentActivity] = useState<string[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = async (refresh = false) => {
    setLoading(true); setError('');
    try { setNetwork(await api.network(refresh)); setApiOnline(true); }
    catch (reason) { setNetwork(localFallbackNetwork()); setApiOnline(false); setError(reason instanceof Error ? reason.message : 'Map summary is unavailable. Open the network explorer to load an area.'); }
    finally { setLoading(false); }
  };
  const updateSensorSummary = useCallback((count: number, investment: number, currency: string) => setSensorSummary({ count, investment, currency }), []);
  const logActivity = useCallback((summary: string) => setRecentActivity((items) => [summary, ...items].slice(0, 5)), []);
  useEffect(() => { void loadSummary(); }, []);

  const title = nav.find((item) => item.id === page)?.title ?? 'Dashboard';
  const realNetwork = selectedArea?.source === 'openstreetmap' || network.source === 'openstreetmap';
  const totalDistance = selectedArea?.metrics.totalRoadDistanceMeters ?? (realNetwork ? network.edges.reduce((sum, edge) => sum + edge.distanceM, 0) : 0);
  const dashboard = <div className="platform-dashboard"><div className="welcome-row"><div><span className="eyebrow">SMART CITY ROAD NETWORK OPTIMIZATION</span><h2>Plan with real road data</h2><p>Explore a location, inspect its road graph, compare routes and plan sensor connections.</p></div><button className="button button-primary" onClick={() => setPage('network')}><MapPinned size={15}/> Explore a road area</button></div>
    <div className="metric-grid">{[
      { label: 'Selected area', value: selectedAreaName || (realNetwork ? 'OpenStreetMap extract' : 'No area loaded'), note: selectedArea?.sourceLabel ?? (realNetwork ? network.sourceLabel : 'Search a place and load an extract'), icon: MapPinned, color: 'blue' },
      { label: 'Road segments', value: selectedArea ? selectedArea.metrics.roadSegments.toLocaleString('en-IN') : realNetwork ? network.edges.length.toLocaleString('en-IN') : '—', note: 'From actual mapped road data', icon: Route, color: 'cyan' },
      { label: 'Junctions', value: selectedArea ? selectedArea.metrics.junctions.toLocaleString('en-IN') : realNetwork ? network.junctions.length.toLocaleString('en-IN') : '—', note: 'Intersections in the loaded graph', icon: Network, color: 'green' },
      { label: 'Road distance', value: realNetwork ? `${(totalDistance / 1000).toFixed(1)} km` : '—', note: realNetwork ? 'Sum of mapped graph edges' : 'No traffic or distance assumptions', icon: Activity, color: 'amber' },
      { label: 'Network connectivity', value: selectedArea ? `${selectedArea.metrics.connectedAreas} component${selectedArea.metrics.connectedAreas === 1 ? '' : 's'}` : '—', note: selectedArea ? selectedArea.metrics.connectedAreas === 1 ? 'Connected graph' : 'Disconnected parts detected' : 'Load an area to analyze', icon: Network, color: 'blue' },
      { label: 'Sensor plan', value: String(sensorSummary.count), note: 'Selected installation locations', icon: Radio, color: 'green' },
      { label: 'Estimated investment', value: new Intl.NumberFormat('en-IN', { style: 'currency', currency: sensorSummary.currency, maximumFractionDigits: 0 }).format(sensorSummary.investment), note: 'Editable user-entered assumptions', icon: Activity, color: 'amber' },
    ].map((item) => <article className="metric-card" key={item.label}><div className={`metric-icon ${item.color}`}><item.icon size={17}/></div><div><span>{item.label}</span><b>{item.value}</b><small>{item.note}</small></div></article>)}</div>
    <div className="dashboard-columns"><div className="dashboard-main"><section className="surface dashboard-intro"><div className="surface-head"><div><div className="surface-title"><MapPinned size={16}/><h2>Start with any mapped place</h2></div><p>Search a city, street, landmark or address. Move the map to select a manageable area and load road geometry from OpenStreetMap.</p></div></div><div className="dashboard-actions"><button className="button button-primary" onClick={() => setPage('network')}>Open road explorer</button><button className="button" onClick={() => setPage('routes')}>Plan a route</button><button className="button" onClick={() => setPage('sensors')}>Plan sensor connections</button></div></section><section className="surface dashboard-data-note"><div className="surface-head"><div><div className="surface-title"><Activity size={16}/><h2>Recent route and scenario activity</h2></div><p>{recentActivity.length ? recentActivity.map((item, index) => <span className="activity-row" key={`${index}-${item}`}>{item}</span>) : 'No route calculations or closure scenarios yet.'}</p></div></div></section><section className="surface dashboard-data-note"><div className="surface-head"><div><div className="surface-title"><Activity size={16}/><h2>Source and estimate guidance</h2></div><p>OpenStreetMap supplies road geometry, not live traffic. OSRM durations are estimates. Sensor placement suggestions use graph properties, and costs are editable assumptions.</p></div></div></section></div><aside className="dashboard-aside"><section className="surface source-mini"><div className="section-heading"><div><span className="panel-overline">SERVICE STATUS</span><h3>Connected providers</h3></div><button className="icon-button" onClick={() => void loadSummary(true)} title="Refresh map summary"><RefreshCw size={14}/></button></div><div className="data-source-row"><span className="provider-mark osm">OSM</span><div><b>Road geometry</b><small>Overpass API · cached extracts</small></div><span className="provider-state">MAP</span></div><div className="data-source-row"><span className="provider-mark sim">N</span><div><b>Place search</b><small>Nominatim · explicit search</small></div><span className="provider-state">OSM</span></div><div className="data-source-row"><span className="provider-mark sim">R</span><div><b>Route estimates</b><small>OSRM · estimated travel time</small></div><span className="provider-state">ROUTE</span></div><small className="last-update">{loading ? 'Checking backend…' : apiOnline ? `Map summary updated ${new Date(network.updatedAt).toLocaleString()}` : 'Backend unavailable; real area extracts are not replaced with fictional data.'}</small></section></aside></div></div>;

  const content = page === 'overview' ? dashboard : page === 'routes' ? <RoutePlanner onRouteCalculated={logActivity}/> : page === 'network' ? <RoadNetworkExplorer onNetworkLoaded={(area, name) => { setSelectedArea(area); setSelectedAreaName(name); }} onSimulationCalculated={logActivity}/> : page === 'sensors' ? <SensorInfrastructure onPlanSummary={updateSensorSummary}/> : <AnalyticsDashboard network={network} area={selectedArea}/>;
  return <div className="smartflow-shell"><aside className={`smart-sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="smart-brand"><span className="smart-logo"><Activity size={19}/></span><div><b>SMARTFLOW</b><small>ROAD NETWORK OPTIMIZATION</small></div><button className="sidebar-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={16}/></button></div><div className="sidebar-section-label">WORKSPACE</div>{['PLATFORM','PLANNING','INSIGHTS'].map((group) => <div className="nav-group" key={group}><span>{group}</span>{nav.filter((item) => item.group === group).map((item) => <button key={item.id} className={`smart-nav-item ${page === item.id ? 'nav-selected' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={16}/><span>{item.title}</span></button>)}</div>)}<div className="sidebar-grow"/><div className="sidebar-api-state"><span className={`api-state-light ${apiOnline ? 'api-ok' : ''}`}/><div><b>{apiOnline ? 'Backend connected' : 'Map API unavailable'}</b><small>{apiOnline ? 'Road summary service ready' : 'Area search remains available to retry'}</small></div><button onClick={() => void loadSummary(true)} title="Retry connection"><RefreshCw size={13}/></button></div><div className="sidebar-foot"><b>SMART CITY NETWORKS</b><span>OpenStreetMap · graph analysis</span></div></aside>{mobileNav && <button className="sidebar-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="smart-main"><header className="command-header"><div className="command-title"><button className="mobile-nav-button icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={18}/></button><div><div className="crumb">SMARTFLOW <span>/</span> {title.toUpperCase()}</div><h1>{title}</h1></div></div><div className="header-controls"><span className={`simulation-status ${realNetwork ? '' : 'status-muted'}`}><span className="status-dot"/>{realNetwork ? 'OSM ROAD DATA' : 'AREA DATA REQUIRED'}</span></div></header><div className="content-area">{error && page === 'overview' && <div className="message-banner" role="status">{error}</div>}{content}<footer className="smart-footer"><span>SMARTFLOW · ROAD NETWORK OPTIMIZATION</span><span>Road geometry and estimates are source-labeled</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></footer></div></main></div>;
}
