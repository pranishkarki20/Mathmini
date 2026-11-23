import { useEffect, useState } from 'react';
import { GeoJSON, MapContainer, Marker, Popup, Polyline, TileLayer, useMapEvents } from 'react-leaflet';
import type { Layer } from 'leaflet';
import { Activity, AlertTriangle, Layers3, Radio, RefreshCw, Route, TriangleAlert } from 'lucide-react';
import { api, type AreaGraphRoute, type AreaNetworkData, type Feature, type InfrastructurePlan } from '../api';

function VisibleBounds({ onBounds }: { onBounds: (bbox: [number, number, number, number]) => void }) {
  const map = useMapEvents({ moveend() { const bounds = map.getBounds(); onBounds([bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]); } });
  useEffect(() => { const bounds = map.getBounds(); onBounds([bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]); }, [map, onBounds]);
  return null;
}

export default function RoadNetworkExplorer() {
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [network, setNetwork] = useState<AreaNetworkData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [closedRoads, setClosedRoads] = useState<string[]>([]);
  const [start, setStart] = useState('');
  const [destination, setDestination] = useState('');
  const [baseline, setBaseline] = useState<AreaGraphRoute | null>(null);
  const [modified, setModified] = useState<AreaGraphRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [sensorSites, setSensorSites] = useState<string[]>([]);
  const [installCostPerKm, setInstallCostPerKm] = useState(250000);
  const [infrastructurePlan, setInfrastructurePlan] = useState<InfrastructurePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const loadArea = async (refresh = false) => {
    if (!bbox) return;
    setLoading(true); setError('');
    try {
      const data = await api.networkArea(bbox, refresh);
      setNetwork(data); setClosedRoads([]); setBaseline(null); setModified(null);
      setStart(data.junctions[0]?.id ?? ''); setDestination(data.junctions[1]?.id ?? ''); setSensorSites(data.junctions.slice(0, 3).map((item) => item.id)); setInfrastructurePlan(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load roads for this map area.'); }
    finally { setLoading(false); }
  };
  const toggleClosure = (roadId: string) => setClosedRoads((items) => items.includes(roadId) ? items.filter((id) => id !== roadId) : [...items, roadId]);
  const recalculate = async () => {
    if (!network || !start || !destination) return;
    setRouteLoading(true); setError('');
    try {
      const bounds = network.bbox;
      const [normal, changed] = await Promise.all([
        api.routeArea({ bbox: bounds, start, destination, closedRoadIds: [] }),
        api.routeArea({ bbox: bounds, start, destination, closedRoadIds: closedRoads }),
      ]);
      setBaseline(normal); setModified(changed);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not recalculate this road network.'); }
    finally { setRouteLoading(false); }
  };
  const buildInfrastructurePlan = async () => {
    if (!network || sensorSites.length < 2) return;
    setPlanLoading(true); setError('');
    try { setInfrastructurePlan(await api.planInfrastructure({ bbox: network.bbox, junctionIds: sensorSites, estimatedCostPerKm: installCostPerKm })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not estimate the infrastructure connections.'); }
    finally { setPlanLoading(false); }
  };
  const boundsChanged = (next: [number, number, number, number]) => setBbox((prior) => prior && prior.every((value, index) => Math.abs(value - next[index]) < 0.0001) ? prior : next);
  const activeRoute = modified?.reachable ? modified.segments.flatMap((segment) => segment.coordinates).map(([lon, lat]) => [lat, lon] as [number, number]) : [];
  const critical = new Set(network?.metrics.criticalJunctionIds ?? []);
  const roadStyle = (feature?: Feature) => {
    const closed = feature?.properties.roadId && closedRoads.includes(feature.properties.roadId);
    return { color: closed ? '#e5485d' : '#4588c8', weight: closed ? 5 : 3, opacity: closed ? 1 : .8, dashArray: closed ? '7 5' : undefined };
  };
  const onEachRoad = (feature: Feature, layer: Layer) => {
    layer.bindTooltip(`${feature.properties.name}${closedRoads.includes(feature.properties.roadId) ? ' · CLOSED IN SIMULATION' : ' · click to simulate closure'}`);
    layer.on('click', () => toggleClosure(feature.properties.roadId));
  };

  return <div className="network-explorer"><div className="module-title-row"><div><span className="eyebrow">OPENSTREETMAP ROAD NETWORK</span><h2>Explore and assess a road area</h2><p>Pan and zoom to an area, load its mapped roads, then test temporary closures on the downloaded network.</p></div><button className="button button-primary" onClick={() => loadArea()} disabled={!bbox || loading}><Layers3 size={14} />{loading ? 'Loading OSM roads…' : 'Load roads in visible area'}</button></div>
    {network?.metrics && <div className="metric-grid network-metrics">{[
      ['Road segments', network.metrics.roadSegments.toLocaleString()],
      ['Junctions', network.metrics.junctions.toLocaleString()],
      ['Road length', `${(network.metrics.totalRoadDistanceMeters / 1000).toFixed(1)} km`],
      ['Connected areas', String(network.metrics.connectedAreas)],
      ['Critical junctions', String(network.metrics.criticalJunctions)],
    ].map(([label, value]) => <article className="metric-card" key={label}><div className="metric-icon blue"><Activity size={16} /></div><div><span>{label}</span><b>{value}</b><small>From selected OSM extract</small></div></article>)}</div>}
    <div className="network-explorer-grid"><section className="surface network-map-panel"><div className="network-map-title"><div><b>{network ? 'Selected road network' : 'Select an area on the map'}</b><small>{network?.sourceLabel ?? 'Move the map to any area, zoom in, then load its roads.'}</small></div>{network && <button className="button button-quiet" onClick={() => loadArea(true)} disabled={loading}><RefreshCw size={13} /> Refresh extract</button>}</div><MapContainer center={[12.9716, 77.5946]} zoom={13} scrollWheelZoom className="network-leaflet-map"><TileLayer attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" /><VisibleBounds onBounds={boundsChanged} />{network && <><GeoJSON key={`${network.bbox.join(',')}:${closedRoads.join(',')}`} data={network.features as never} style={roadStyle as never} onEachFeature={onEachRoad as never} />{network.junctions.map((junction) => <Marker key={junction.id} position={[junction.latitude, junction.longitude]}><Popup><b>{junction.name}</b><br />{junction.roadCount} road connections<br />{critical.has(junction.id) ? 'Vulnerable junction: this point connects separate parts of this extract.' : 'Mapped intersection'}</Popup></Marker>)}{activeRoute.length > 1 && <Polyline positions={activeRoute} pathOptions={{ color: '#18b88a', weight: 6 }} />}{infrastructurePlan?.connections.flatMap((connection) => connection.segments).map((segment, index) => <Polyline key={`sensor-link-${index}`} positions={segment.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: '#a75be8', weight: 5, dashArray: '8 5' }} />)}</>}</MapContainer><div className="network-map-legend"><span><i className="road-open" />Mapped road</span><span><i className="road-closed" />Simulated closure</span><span><i className="road-route" />Recalculated route</span><span><i className="critical-junction" />Vulnerable junction</span></div></section>
    <aside className="surface network-tools"><div className="network-tool-section"><span className="panel-overline">AREA COVERAGE</span><h3>Visible map bounds</h3><p>{bbox ? `${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)} to ${bbox[2].toFixed(4)}, ${bbox[3].toFixed(4)}` : 'Move the map to choose an area.'}</p><small>Overpass requests are capped at 0.12° per side and cached locally to limit repeat downloads.</small></div>{network && <><div className="network-tool-section"><span className="panel-overline">DISRUPTION SCENARIO</span><h3>Temporary road closures</h3><p>Click a road on the map to close or reopen it for this scenario.</p><div className="closure-status"><TriangleAlert size={14} />{closedRoads.length ? `${closedRoads.length} road${closedRoads.length === 1 ? '' : 's'} closed in simulation` : 'No simulated closures'}</div><button className="button button-quiet button-wide" onClick={() => setClosedRoads([])} disabled={!closedRoads.length}>Reopen all roads</button></div><div className="network-tool-section"><span className="panel-overline">NETWORK RESILIENCE</span><h3>Check a connection</h3><label className="form-field"><span>From intersection</span><select value={start} onChange={(event) => setStart(event.target.value)}>{network.junctions.map((junction) => <option key={junction.id} value={junction.id}>{junction.name}</option>)}</select></label><label className="form-field"><span>To intersection</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{network.junctions.map((junction) => <option key={junction.id} value={junction.id}>{junction.name}</option>)}</select></label><button className="button button-primary button-wide" onClick={recalculate} disabled={routeLoading || !start || !destination || start === destination}><Route size={14} />{routeLoading ? 'Recalculating…' : 'Compare route impact'}</button>{modified && <div className={`network-route-impact ${modified.reachable ? '' : 'impact-disconnected'}`}><b>{modified.reachable ? 'Connection remains open' : 'These locations are disconnected'}</b>{modified.reachable && <span>{(modified.distanceMeters / 1000).toFixed(2)} km after closures</span>}{baseline?.reachable && modified.reachable && <small>Before closures: {(baseline.distanceMeters / 1000).toFixed(2)} km</small>}{!modified.reachable && <small>{modified.message}</small>}</div>}</div><div className="network-tool-section"><span className="panel-overline">INFRASTRUCTURE PLANNING</span><h3>Connect monitoring sites</h3><p>Select mapped intersections. Purple links show a low-distance connected installation plan.</p><label className="form-field"><span>Estimated installation cost per road km (INR)</span><input type="number" min="0" step="10000" value={installCostPerKm} onChange={(event) => setInstallCostPerKm(Number(event.target.value))} /></label><div className="network-junction-options">{network.junctions.slice(0, 40).map((junction) => <label key={junction.id}><input type="checkbox" checked={sensorSites.includes(junction.id)} onChange={() => { setSensorSites((current) => current.includes(junction.id) ? current.filter((id) => id !== junction.id) : [...current, junction.id]); setInfrastructurePlan(null); }} /><span>{junction.name}</span></label>)}</div><small>Showing up to 40 intersections in the loaded area. Costs are estimates you enter; no supplier quote data is available.</small><button className="button button-primary button-wide" onClick={buildInfrastructurePlan} disabled={planLoading || sensorSites.length < 2}><Radio size={14} />{planLoading ? 'Estimating connections?' : 'Build connection plan'}</button>{infrastructurePlan && <div className="network-route-impact"><b>{infrastructurePlan.connected ? `${infrastructurePlan.connections.length} connections ? ${(infrastructurePlan.totalDistanceMeters / 1000).toFixed(2)} km` : 'Selected sites span disconnected road areas'}</b><span>Estimated installation: ?{infrastructurePlan.estimatedInstallationCost.toLocaleString('en-IN')}</span><small>{infrastructurePlan.costBasis}</small></div>}</div><div className="network-tool-section network-critical-note"><span className="panel-overline">VULNERABLE CONNECTIONS</span><p><AlertTriangle size={14} />{network.metrics.criticalJunctions ? `${network.metrics.criticalJunctions} junctions in this extract link otherwise separate road areas. A disruption here can sever local connectivity.` : 'No single-junction bottlenecks were identified in this extract.'}</p></div></>}{error && <div className="osm-route-error" role="alert">{error}</div>}</aside></div><footer className="osm-route-footer">OSM road geometry is not live traffic. Closure results use the downloaded road graph and shortest road distance; OSRM route estimates remain a separate service.</footer></div>;
}
