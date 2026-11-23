import { useEffect, useState, type FormEvent } from 'react';

import { GeoJSON, MapContainer, Marker, Popup, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import type { Layer } from 'leaflet';

import { Activity, AlertTriangle, Layers3, Radio, RefreshCw, Route, TriangleAlert } from 'lucide-react';

import { api, type AreaGraphRoute, type AreaNetworkData, type ClosureScenario, type Feature, type InfrastructurePlan, type OSMPlace } from '../api';



function SearchMapController({ place }: { place: OSMPlace | null }) {

  const map = useMap();

  useEffect(() => { if (place) map.setView([place.latitude, place.longitude], 15); }, [map, place]);

  return null;

}



function VisibleBounds({ onBounds }: { onBounds: (bbox: [number, number, number, number]) => void }) {

  const map = useMapEvents({ moveend() { const bounds = map.getBounds(); onBounds([bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]); } });

  useEffect(() => { const bounds = map.getBounds(); onBounds([bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]); }, [map, onBounds]);

  return null;

}



export default function RoadNetworkExplorer({ onNetworkLoaded, onSimulationCalculated }: { onNetworkLoaded?: (network: AreaNetworkData, label: string) => void; onSimulationCalculated?: (summary: string) => void }) {

  const maxAreaSpan = 0.12;

  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);

  const [network, setNetwork] = useState<AreaNetworkData | null>(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState('');

  const [closedRoads, setClosedRoads] = useState<string[]>([]);

  const [start, setStart] = useState('');

  const [destination, setDestination] = useState('');

  const [baseline, setBaseline] = useState<AreaGraphRoute | null>(null);

  const [modified, setModified] = useState<AreaGraphRoute | null>(null);
  const [routeComparisons, setRouteComparisons] = useState<Record<'shortest' | 'fastest', { before: AreaGraphRoute; after: AreaGraphRoute }> | null>(null);

  const [routeLoading, setRouteLoading] = useState(false);

  const [sensorSites, setSensorSites] = useState<string[]>([]);

  const [installCostPerKm, setInstallCostPerKm] = useState(250000);

  const [infrastructurePlan, setInfrastructurePlan] = useState<InfrastructurePlan | null>(null);

  const [planLoading, setPlanLoading] = useState(false);

  const [placeQuery, setPlaceQuery] = useState('');

  const [places, setPlaces] = useState<OSMPlace[]>([]);

  const [placeLoading, setPlaceLoading] = useState(false);

  const [selectedPlace, setSelectedPlace] = useState<OSMPlace | null>(null);

  const [savedScenario, setSavedScenario] = useState<ClosureScenario | null>(null);



  const loadArea = async (refresh = false) => {

    if (!bbox) return;

    setLoading(true); setError('');

    try {

      const data = await api.networkArea(bbox, refresh);

      setNetwork(data); onNetworkLoaded?.(data, selectedPlace?.displayName ?? `Map area ${data.bbox.map((value) => value.toFixed(4)).join(', ')}`); setClosedRoads([]); setBaseline(null); setModified(null);

      setStart(data.junctions[0]?.id ?? ''); setDestination(data.junctions[1]?.id ?? ''); setSensorSites([]); setInfrastructurePlan(null);

      const latest = await api.latestClosureScenario().catch(() => ({ scenario: null }));

      setSavedScenario(latest.scenario);

      if (latest.scenario && latest.scenario.bbox.every((value, index) => Math.abs(value - data.bbox[index]) < 0.00001)) {

        setClosedRoads(latest.scenario.closedRoadIds); setStart(latest.scenario.start || data.junctions[0]?.id || ''); setDestination(latest.scenario.destination || data.junctions[1]?.id || '');

      }

    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load roads for this map area.'); }

    finally { setLoading(false); }

  };

  const toggleClosure = (roadId: string) => setClosedRoads((items) => items.includes(roadId) ? items.filter((id) => id !== roadId) : [...items, roadId]);

  const recalculate = async () => {

    if (!network || !start || !destination) return;

    setRouteLoading(true); setError('');

    try {

      const bounds = network.bbox;

      const [shortestBefore, shortestAfter, fastestBefore, fastestAfter] = await Promise.all([
        api.routeArea({ bbox: bounds, start, destination, closedRoadIds: [], preference: 'shortest' }),
        api.routeArea({ bbox: bounds, start, destination, closedRoadIds: closedRoads, preference: 'shortest' }),
        api.routeArea({ bbox: bounds, start, destination, closedRoadIds: [], preference: 'fastest' }),
        api.routeArea({ bbox: bounds, start, destination, closedRoadIds: closedRoads, preference: 'fastest' }),
      ]);
      setBaseline(shortestBefore); setModified(shortestAfter);
      setRouteComparisons({ shortest: { before: shortestBefore, after: shortestAfter }, fastest: { before: fastestBefore, after: fastestAfter } });
      onSimulationCalculated?.(shortestAfter.reachable ? `Closure scenario | ${closedRoads.length} road(s) | ${(shortestAfter.distanceMeters / 1000).toFixed(2)} km shortest route` : `Closure scenario | ${closedRoads.length} road(s) | selected junctions disconnected`);
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

  const saveScenario = async () => {

    if (!network) return;

    try {

      const saved = await api.saveClosureScenario({ name: `Road scenario · ${new Date().toLocaleDateString()}`, bbox: network.bbox, closedRoadIds: closedRoads, start, destination });

      setSavedScenario({ id: saved.id, name: saved.name, bbox: network.bbox, closedRoadIds: closedRoads, start, destination, updatedAt: saved.updatedAt });

      setError('Closure scenario saved to the backend.');

    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this closure scenario.'); }

  };

  const boundsChanged = (next: [number, number, number, number]) => setBbox((prior) => prior && prior.every((value, index) => Math.abs(value - next[index]) < 0.0001) ? prior : next);

  const searchPlace = async (event: FormEvent) => {

    event.preventDefault();

    if (!placeQuery.trim()) return;

    setPlaceLoading(true); setError(''); setPlaces([]);

    try { setPlaces((await api.searchPlaces(placeQuery.trim())).results); }

    catch (reason) { setError(reason instanceof Error ? reason.message : 'Place search is unavailable.'); }

    finally { setPlaceLoading(false); }

  };

  const exportReportCsv = () => {

    if (!network) return;

    const rows: (string | number | null | undefined)[][] = [

      ['SmartFlow road network report'], ['Area bounds (S,W,N,E)', network.bbox.join(', ')],

      ['Data source', network.sourceLabel], ['Retrieved at', network.retrievedAt ?? 'Unavailable'],

      ['Road segments', network.metrics.roadSegments], ['Junctions', network.metrics.junctions],

      ['Mapped road distance (km)', (network.metrics.totalRoadDistanceMeters / 1000).toFixed(2)],

      ['Connected components', network.metrics.connectedAreas], ['Articulation points', network.metrics.criticalJunctions],

      ['Bridge road segments', network.metrics.criticalRoadSegments ?? 0], ['Scenario closed roads', closedRoads.join('; ')],

      ['Baseline route distance (m)', baseline?.distanceMeters ?? ''], ['Scenario route distance (m)', modified?.distanceMeters ?? ''],

      ['Baseline estimated duration (min)', baseline?.estimatedDurationMinutes ?? ''], ['Scenario estimated duration (min)', modified?.estimatedDurationMinutes ?? ''],

      [], ['Road classification', 'Segments'],

      ...Object.entries(network.features.features.reduce<Record<string, number>>((counts, feature) => { const kind = feature.properties.highway || 'unclassified'; counts[kind] = (counts[kind] ?? 0) + 1; return counts; }, {})).map(([kind, count]) => [kind, count]),

    ];

    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');

    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'smartflow-road-network-report.csv'; link.click(); URL.revokeObjectURL(link.href);

  };

  const areaTooLarge = !!bbox && (bbox[2] - bbox[0] > maxAreaSpan || bbox[3] - bbox[1] > maxAreaSpan);

  const activeRoute = modified?.reachable ? modified.segments.flatMap((segment) => segment.coordinates).map(([lon, lat]) => [lat, lon] as [number, number]) : [];

  const critical = new Set(network?.metrics.criticalJunctionIds ?? []);

  const roadStyle = (feature?: Feature) => {

    const closed = feature?.properties.roadId && closedRoads.includes(feature.properties.roadId);

    const criticalRoad = feature?.properties.roadId && (network?.metrics.criticalRoadIds ?? []).includes(feature.properties.roadId);

    return { color: closed ? '#e5485d' : criticalRoad ? '#a855f7' : '#4588c8', weight: closed ? 5 : criticalRoad ? 4 : 3, opacity: closed || criticalRoad ? 1 : .8, dashArray: closed ? '7 5' : criticalRoad ? '4 3' : undefined };

  };

  const onEachRoad = (feature: Feature, layer: Layer) => {

    layer.bindTooltip(`${feature.properties.name}${closedRoads.includes(feature.properties.roadId) ? ' · CLOSED IN SIMULATION' : ' · click to simulate closure'}`);

    layer.on('click', () => toggleClosure(feature.properties.roadId));

  };



  return <div className="network-explorer"><div className="module-title-row"><div><span className="eyebrow">OPENSTREETMAP ROAD NETWORK</span><h2>Explore and assess a road area</h2><p>Search any place, adjust the map, then load its mapped roads and assess route or closure impacts.</p></div>{network && <div className="network-report-actions"><button className="button" onClick={exportReportCsv}>Export CSV</button><button className="button" onClick={() => window.print()}>Print / save PDF</button></div>}</div>

    <form className="network-place-search" onSubmit={searchPlace}><input value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="Search a city, street, landmark or address" aria-label="Search map location"/><button className="button" disabled={placeLoading || !placeQuery.trim()}>{placeLoading ? 'Searching…' : 'Search places'}</button><button type="button" className="button button-primary" onClick={() => loadArea()} disabled={!bbox || areaTooLarge || loading}><Layers3 size={14} />{loading ? 'Loading roads…' : areaTooLarge ? 'Zoom in to load area' : 'Load visible area'}</button></form>{places.length > 0 && <div className="network-place-results">{places.map((place) => <button key={place.placeId} onClick={() => { setSelectedPlace(place); setPlaces([]); }} type="button">{place.displayName}</button>)}</div>}

    {network?.metrics && <div className="metric-grid network-metrics">{[

      ['Road segments', network.metrics.roadSegments.toLocaleString()],

      ['Junctions', network.metrics.junctions.toLocaleString()],

      ['Road length', `${(network.metrics.totalRoadDistanceMeters / 1000).toFixed(1)} km`],

      ['Connected areas', String(network.metrics.connectedAreas)],

      ['Critical junctions', String(network.metrics.criticalJunctions)],

      ['Critical road links', String(network.metrics.criticalRoadSegments ?? 0)],

    ].map(([label, value]) => <article className="metric-card" key={label}><div className="metric-icon blue"><Activity size={16} /></div><div><span>{label}</span><b>{value}</b><small>From selected OSM extract</small></div></article>)}</div>}

    <div className="network-explorer-grid"><section className="surface network-map-panel"><div className="network-map-title"><div><b>{network ? 'Selected road network' : 'Select an area on the map'}</b><small>{network?.sourceLabel ?? 'Search for a place or pan and zoom. Load a small map area to analyze its actual OSM roads.'}</small></div>{network && <button className="button button-quiet" onClick={() => loadArea(true)} disabled={loading || areaTooLarge}><RefreshCw size={13} /> Refresh extract</button>}</div><MapContainer center={[20, 0]} zoom={2} scrollWheelZoom className="network-leaflet-map"><SearchMapController place={selectedPlace} /><TileLayer attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" /><VisibleBounds onBounds={boundsChanged} />{network && <><GeoJSON key={`${network.bbox.join(',')}:${closedRoads.join(',')}`} data={network.features as never} style={roadStyle as never} onEachFeature={onEachRoad as never} />{network.junctions.map((junction) => <Marker key={junction.id} position={[junction.latitude, junction.longitude]}><Popup><b>{junction.name}</b><br />{junction.roadCount} road connections<br />{critical.has(junction.id) ? 'Vulnerable junction: this point connects separate parts of this extract.' : 'Mapped intersection'}</Popup></Marker>)}{activeRoute.length > 1 && <Polyline positions={activeRoute} pathOptions={{ color: '#18b88a', weight: 6 }} />}{infrastructurePlan?.connections.flatMap((connection) => connection.segments).map((segment, index) => <Polyline key={`sensor-link-${index}`} positions={segment.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: '#a75be8', weight: 5, dashArray: '8 5' }} />)}</>}</MapContainer><div className="network-map-legend"><span><i className="road-open" />Mapped road</span><span><i className="road-closed" />Simulated closure</span><span><i className="road-route" />Recalculated route</span><span><i className="critical-junction" />Articulation point</span><span><i className="critical-road" />Bridge road link</span></div></section>

    <aside className="surface network-tools"><div className="network-tool-section"><span className="panel-overline">AREA COVERAGE</span><h3>Visible map bounds</h3><p>{bbox ? `${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)} to ${bbox[2].toFixed(4)}, ${bbox[3].toFixed(4)}` : 'Move the map to choose an area.'}</p><small>{areaTooLarge ? 'Zoom in: each map span must be 0.12 degrees or less before loading roads.' : 'Overpass requests are capped at 0.12 degrees per side and cached locally to limit repeat downloads.'}</small></div>{network && <><div className="network-tool-section"><span className="panel-overline">DISRUPTION SCENARIO</span><h3>Temporary road closures</h3><p>Click a road on the map to close or reopen it for this scenario.</p><div className="closure-status"><TriangleAlert size={14} />{closedRoads.length ? `${closedRoads.length} road${closedRoads.length === 1 ? '' : 's'} closed in simulation` : 'No simulated closures'}</div><button className="button button-quiet button-wide" onClick={() => setClosedRoads([])} disabled={!closedRoads.length}>Reopen all roads</button><button className="button button-quiet button-wide" onClick={() => void saveScenario()} disabled={!network}>Save closure scenario</button>{savedScenario && savedScenario.bbox.every((value, index) => Math.abs(value - network.bbox[index]) < 0.00001) && <button className="button button-quiet button-wide" onClick={() => { setClosedRoads(savedScenario.closedRoadIds); setStart(savedScenario.start); setDestination(savedScenario.destination); }}>Restore saved scenario</button>}</div><div className="network-tool-section"><span className="panel-overline">NETWORK RESILIENCE</span><h3>Check a connection</h3><label className="form-field"><span>From intersection</span><select value={start} onChange={(event) => setStart(event.target.value)}>{network.junctions.map((junction) => <option key={junction.id} value={junction.id}>{junction.name}</option>)}</select></label><label className="form-field"><span>To intersection</span><select value={destination} onChange={(event) => setDestination(event.target.value)}>{network.junctions.map((junction) => <option key={junction.id} value={junction.id}>{junction.name}</option>)}</select></label><button className="button button-primary button-wide" onClick={recalculate} disabled={routeLoading || !start || !destination || start === destination}><Route size={14} />{routeLoading ? 'Recalculating…' : 'Compare route impact'}</button>{routeComparisons && <div className="route-comparison-cards">{[{ label: 'Shortest distance', value: routeComparisons.shortest }, { label: 'Estimated fastest', value: routeComparisons.fastest }].map(({ label, value }) => <article key={label}><b>{label}</b>{value.after.reachable ? <span>Before: {(value.before.distanceMeters / 1000).toFixed(2)} km · ~{value.before.estimatedDurationMinutes ?? '—'} min<br/>Scenario: {(value.after.distanceMeters / 1000).toFixed(2)} km · ~{value.after.estimatedDurationMinutes ?? '—'} min</span> : <span>Disconnected after simulated closures</span>}<small>Estimated duration uses road-class speeds, not live traffic.</small></article>)}</div>}</div><div className="network-tool-section"><span className="panel-overline">INFRASTRUCTURE PLANNING</span><h3>Connect monitoring sites</h3><p>Select mapped intersections. Purple links show a low-distance connected installation plan.</p><label className="form-field"><span>Estimated installation cost per road km (INR)</span><input type="number" min="0" step="10000" value={installCostPerKm} onChange={(event) => setInstallCostPerKm(Number(event.target.value))} /></label><div className="network-junction-options">{network.junctions.slice(0, 40).map((junction) => <label key={junction.id}><input type="checkbox" checked={sensorSites.includes(junction.id)} onChange={() => { setSensorSites((current) => current.includes(junction.id) ? current.filter((id) => id !== junction.id) : [...current, junction.id]); setInfrastructurePlan(null); }} /><span>{junction.name}</span></label>)}</div><small>Showing up to 40 intersections in the loaded area. Costs are estimates you enter; no supplier quote data is available.</small><button className="button button-primary button-wide" onClick={buildInfrastructurePlan} disabled={planLoading || sensorSites.length < 2}><Radio size={14} />{planLoading ? 'Estimating connections…' : 'Build connection plan'}</button>{infrastructurePlan && <div className="network-route-impact"><b>{infrastructurePlan.connected ? `${infrastructurePlan.connections.length} connections · ${(infrastructurePlan.totalDistanceMeters / 1000).toFixed(2)} km` : 'Selected sites span disconnected road areas'}</b><span>Estimated installation: ₹{infrastructurePlan.estimatedInstallationCost.toLocaleString('en-IN')}</span><small>{infrastructurePlan.costBasis}</small></div>}</div><div className="network-tool-section network-critical-note"><span className="panel-overline">CRITICAL NETWORK ELEMENTS</span><p><AlertTriangle size={14} />{network.metrics.criticalJunctions || (network.metrics.criticalRoadSegments ?? 0) ? `${network.metrics.criticalJunctions} articulation points and ${network.metrics.criticalRoadSegments ?? 0} bridge road segments were found. Removing these can split the mapped network.` : 'No articulation points or bridge road segments were identified in this extract.'}</p></div></>}{error && <div className="osm-route-error" role="alert">{error}</div>}</aside></div><footer className="osm-route-footer">OSM road geometry is not live traffic. Closure results use the downloaded road graph and shortest road distance; OSRM route estimates remain a separate service.</footer></div>;

}

