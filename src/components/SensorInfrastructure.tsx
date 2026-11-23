import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { Download, MapPin, RotateCcw, Search, Trash2 } from 'lucide-react';
import { api, type AreaNetworkData, type OSMPlace } from '../api';

type SavedLocation = { id: string; name: string; latitude: number; longitude: number; junctionId: string; roadCount: number };
type PersistedPlan = { id: number; name: string; bbox: [number, number, number, number]; junctionIds: string[]; config: Record<string, unknown>; updatedAt: string };

const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);

function Recenter({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (point) map.setView(point, 15); }, [map, point]);
  return null;
}

export default function SensorInfrastructure({ onPlanSummary }: { onPlanSummary?: (count: number, initialInvestment: number, currency: string) => void }) {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<OSMPlace[]>([]);
  const [place, setPlace] = useState<OSMPlace | null>(null);
  const [network, setNetwork] = useState<AreaNetworkData | null>(null);
  const [savedPlan, setSavedPlan] = useState<PersistedPlan | null>(null);
  const [selected, setSelected] = useState<SavedLocation[]>([]);
  const [algorithm, setAlgorithm] = useState<'prim' | 'kruskal'>('kruskal');
  const [objective, setObjective] = useState<'distance' | 'estimated_cost'>('distance');
  const [costPerKm, setCostPerKm] = useState('');
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.planInfrastructure>> | null>(null);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radiusKm, setRadiusKm] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.latestSensorPlan().then((response) => setSavedPlan(response.plan)).catch(() => undefined); }, []);
  useEffect(() => {
    onPlanSummary?.(selected.length, plan?.estimatedInstallationCost ?? 0, 'INR');
  }, [selected.length, plan?.estimatedInstallationCost, onPlanSummary]);

  const search = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await api.searchPlaces(query);
      setPlaces(result.results);
      if (!result.results.length) setError('No places found. Try a nearby city, road or landmark.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Place search failed.');
    } finally {
      setLoading(false);
    }
  };

  const load = async (selectedPlace = place) => {
    if (!selectedPlace) { setError('Search for and select a place first.'); return; }
    const lat = selectedPlace.latitude;
    const lon = selectedPlace.longitude;
    const radius = Math.min(2, Math.max(0.5, radiusKm));
    const latDelta = radius / 111;
    const lonDelta = Math.min(radius / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180))), 0.059);
    const bbox: [number, number, number, number] = [lat - latDelta, lon - lonDelta, lat + latDelta, lon + lonDelta];
    setLoading(true);
    setError('');
    setPlan(null);
    try {
      const data = await api.networkArea(bbox);
      setNetwork(data);
      setSelected([]);
      setCenter([lat, lon]);
      if (!data.junctions.length) setError('No suitable intersections were found. Try a denser or different area.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the road network.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (junction: AreaNetworkData['junctions'][number]) => {
    setPlan(null);
    setError('');
    if (selected.some((item) => item.junctionId === junction.id)) {
      setSelected((items) => items.filter((item) => item.junctionId !== junction.id));
    } else if (selected.length >= 30) {
      setError('Select no more than 30 locations for one plan.');
    } else {
      setSelected((items) => [...items, { id: junction.id, junctionId: junction.id, name: junction.name, latitude: junction.latitude, longitude: junction.longitude, roadCount: junction.roadCount }]);
    }
  };

  const suggestions = useMemo(() => [...(network?.junctions ?? [])].sort((a, b) => b.roadCount - a.roadCount).slice(0, 6), [network]);
  const visibleJunctions = useMemo(() => {
    if (!network) return [];
    const ids = new Set([...network.junctions.slice(0, 1000).map((item) => item.id), ...suggestions.map((item) => item.id), ...selected.map((item) => item.junctionId)]);
    return network.junctions.filter((item) => ids.has(item.id));
  }, [network, suggestions, selected]);

  const selectTopSuggestions = () => {
    setPlan(null);
    setSelected(suggestions.map((item) => ({ id: item.id, junctionId: item.id, name: item.name, latitude: item.latitude, longitude: item.longitude, roadCount: item.roadCount })));
  };

  const optimize = async () => {
    if (!network || selected.length < 2) return;
    const enteredCost = costPerKm.trim() === '' ? 0 : Number(costPerKm);
    if (!Number.isFinite(enteredCost) || enteredCost < 0) {
      setError('Enter a valid cost of 0 or more.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setPlan(await api.planInfrastructure({
        bbox: network.bbox,
        junctionIds: selected.map((item) => item.junctionId),
        estimatedCostPerKm: enteredCost,
        algorithm,
        objective,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not calculate the connection plan.');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!network) return;
    try {
      const name = place?.name ?? 'OSM sensor plan';
      const config = { algorithm, objective, costPerKm: costPerKm.trim() === '' ? 0 : Number(costPerKm) };
      const saved = await api.saveSensorPlan({ name, bbox: network.bbox, junctionIds: selected.map((item) => item.junctionId), config });
      setSavedPlan({ id: saved.id, name, bbox: network.bbox, junctionIds: selected.map((item) => item.junctionId), config, updatedAt: saved.updatedAt });
      setError('Plan saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the plan.');
    }
  };

  const restore = async () => {
    if (!savedPlan) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.networkArea(savedPlan.bbox);
      setNetwork(data);
      setCenter([(savedPlan.bbox[0] + savedPlan.bbox[2]) / 2, (savedPlan.bbox[1] + savedPlan.bbox[3]) / 2]);
      setSelected(data.junctions.filter((item) => savedPlan.junctionIds.includes(item.id)).map((item) => ({ id: item.id, junctionId: item.id, name: item.name, latitude: item.latitude, longitude: item.longitude, roadCount: item.roadCount })));
      if (savedPlan.config.algorithm === 'prim' || savedPlan.config.algorithm === 'kruskal') setAlgorithm(savedPlan.config.algorithm);
      if (savedPlan.config.objective === 'distance' || savedPlan.config.objective === 'estimated_cost') setObjective(savedPlan.config.objective);
      setCostPerKm(typeof savedPlan.config.costPerKm === 'number' ? String(savedPlan.config.costPerKm) : '');
      setPlan(null);
      setError('Saved plan restored. Select Calculate plan to redraw the links.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore the plan.');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Sensor infrastructure planning report'],
      ['Algorithm', algorithm],
      ['Objective', objective],
      ['Estimated distance (m)', plan?.totalDistanceMeters ?? 0],
      ['Estimated installation cost (INR)', plan?.estimatedInstallationCost ?? 0],
      [],
      ['Location', 'Latitude', 'Longitude', 'Connected roads'],
      ...selected.map((item) => [item.name, item.latitude, item.longitude, item.roadCount]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'sensor-minimum-spanning-plan.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return <div className="sensor-mvp">
    <section className="surface sensor-mvp-header">
      <div>
        <span className="eyebrow">MINIMUM SPANNING PLAN</span>
        <h2>Connect sensor locations</h2>
        <p>Choose real intersections, then use Prim or Kruskal to find the shortest connected network.</p>
      </div>
      {savedPlan && <button className="button button-quiet" onClick={() => void restore()} disabled={loading}><RotateCcw size={14} /> Restore saved plan</button>}
    </section>

    <section className="surface sensor-mvp-area">
      <div className="sensor-step"><span>1</span><div><b>Choose an area</b><small>Search for a place and load the nearby road network.</small></div></div>
      <div className="sensor-search-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="City, road or landmark" />
        <button className="button button-quiet" onClick={() => void search()} disabled={loading || query.trim().length < 3}><Search size={14} /> Search</button>
        {places.length > 0 && <select aria-label="Place search results" value={place?.placeId ?? ''} onChange={(event) => { const item = places.find((candidate) => candidate.placeId === event.target.value); if (item) setPlace(item); }}><option value="">Select a place</option>{places.map((item) => <option key={item.placeId} value={item.placeId}>{item.displayName}</option>)}</select>}
        <label className="sensor-radius">Radius
          <input type="number" min="0.5" max="2" step="0.5" value={radiusKm} onChange={(event) => setRadiusKm(Math.max(0.5, Math.min(2, Number(event.target.value))))} /> km
        </label>
        <button className="button button-primary" onClick={() => void load()} disabled={!place || loading}><MapPin size={14} /> {loading ? 'Loading...' : 'Load roads'}</button>
      </div>
      {error && <div className="osm-route-error" role="alert">{error}</div>}
    </section>

    <div className="sensor-mvp-layout">
      <section className="surface sensor-mvp-map">
        <div className="network-map-title">
          <div><b>{network?.sourceLabel ?? 'Road map'}</b><small>{network ? `${network.metrics.roadSegments.toLocaleString()} road segments · ${network.junctions.length.toLocaleString()} intersections` : 'Load an area to begin'}</small></div>
        </div>
        <MapContainer center={center ?? [12.9716, 77.5946]} zoom={center ? 14 : 5} className="sensor-mvp-leaflet">
          <Recenter point={center} />
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {network && <>
            <GeoJSON data={network.features as never} style={() => ({ color: '#4387c9', weight: 3, opacity: 0.8 })} />
            {visibleJunctions.map((junction) => {
              const isSelected = selected.some((item) => item.junctionId === junction.id);
              const isSuggested = suggestions.some((item) => item.id === junction.id);
              return <CircleMarker key={junction.id} center={[junction.latitude, junction.longitude]} radius={isSelected ? 9 : isSuggested ? 7 : 4} pathOptions={{ color: '#fff', weight: 2, fillColor: isSelected ? '#24bd88' : isSuggested ? '#f4a642' : '#5388bb', fillOpacity: 1 }} eventHandlers={{ click: () => toggle(junction) }}>
                <Popup><b>{junction.name}</b><br />{junction.roadCount} mapped roads<br />{isSelected ? 'Selected sensor location' : 'Click to select'}</Popup>
              </CircleMarker>;
            })}
            {plan?.connections.flatMap((connection) => connection.segments).map((segment, index) => <Polyline key={index} positions={segment.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: '#ed8b48', weight: 5 }} />)}
          </>}
        </MapContainer>
        <div className="network-map-legend"><span><i className="sensor-suggested-dot" />Suggested junction</span><span><i className="sensor-selected-dot" />Selected location</span><span><i className="sensor-network-line" />Minimum spanning network</span></div>
      </section>

      <aside className="surface sensor-mvp-controls">
        <div className="sensor-mvp-section">
          <div className="sensor-step"><span>2</span><div><b>Select locations</b><small>{selected.length} selected · minimum 2</small></div></div>
          {network && <button className="button button-quiet button-wide" onClick={selectTopSuggestions}>Select top 6 junctions</button>}
          <div className="sensor-mvp-suggestions">
            {suggestions.map((item) => {
              const isSelected = selected.some((site) => site.junctionId === item.id);
              return <button type="button" className={isSelected ? 'sensor-mvp-site is-selected' : 'sensor-mvp-site'} key={item.id} onClick={() => toggle(item)}><span>{isSelected ? '✓' : '+'}</span><b>{item.name}</b><small>{item.roadCount} roads</small></button>;
            })}
            {!network && <small>Load a road area first.</small>}
          </div>
        </div>

        <div className="sensor-mvp-section">
          <div className="sensor-step"><span>3</span><div><b>Build the network</b><small>Choose a simple algorithm and objective.</small></div></div>
          <div className="sensor-method-choice">
            <span className="sensor-choice-label">Connection method</span>
            <button type="button" className={algorithm === 'kruskal' ? 'sensor-choice is-selected' : 'sensor-choice'} onClick={() => { setAlgorithm('kruskal'); setPlan(null); }}><b>Kruskal</b><span>Add the cheapest road first. Skip roads that make a loop.</span></button>
            <button type="button" className={algorithm === 'prim' ? 'sensor-choice is-selected' : 'sensor-choice'} onClick={() => { setAlgorithm('prim'); setPlan(null); }}><b>Prim</b><span>Start at one place, then connect the nearest unconnected place.</span></button>
          </div>
          <div className="sensor-method-choice">
            <span className="sensor-choice-label">What should the app minimize?</span>
            <button type="button" className={objective === 'distance' ? 'sensor-choice is-selected' : 'sensor-choice'} onClick={() => { setObjective('distance'); setPlan(null); }}><b>Shortest distance</b><span>Use the least total road length.</span></button>
            <button type="button" className={objective === 'estimated_cost' ? 'sensor-choice is-selected' : 'sensor-choice'} onClick={() => { setObjective('estimated_cost'); setPlan(null); }}><b>Estimated cost</b><span>Use your cost per kilometre.</span></button>
          </div>
          {objective === 'estimated_cost' && <label className="form-field"><span>Cost per road kilometre (INR)</span><input type="number" min="0" step="any" placeholder="Enter cost" value={costPerKm} onChange={(event) => { setCostPerKm(event.target.value); setPlan(null); }} /></label>}
          <button className="button button-primary button-wide" onClick={() => void optimize()} disabled={loading || selected.length < 2}>{loading ? 'Calculating...' : 'Calculate minimum plan'}</button>
        </div>

        {plan && <div className="sensor-mvp-result">
          <span className="panel-overline">PLAN RESULT</span>
          <div className="sensor-mvp-metrics"><div><span>Locations</span><b>{selected.length}</b></div><div><span>Connections</span><b>{plan.connections.length}</b></div><div><span>Road length</span><b>{(plan.totalDistanceMeters / 1000).toFixed(2)} km</b></div><div><span>Est. cost</span><b>{money(plan.estimatedInstallationCost)}</b></div></div>
          <p>{algorithm === 'prim' ? 'Prim' : 'Kruskal'} found the minimum spanning network. It has no redundant backup routes.</p>
          <div className="sensor-mvp-actions"><button className="button button-quiet" onClick={exportCsv} disabled={!plan}><Download size={14} /> Export CSV</button><button className="button button-primary" onClick={() => void save()} disabled={!network}>Save plan</button></div>
        </div>}

        {!plan && selected.length > 0 && <div className="sensor-mvp-selected">
          <span className="panel-overline">SELECTED LOCATIONS</span>
          {selected.map((item) => <div key={item.id}><b>{item.name}</b><button aria-label={`Remove ${item.name}`} onClick={() => toggle({ id: item.junctionId, name: item.name, latitude: item.latitude, longitude: item.longitude, roadCount: item.roadCount })}><Trash2 size={13} /></button></div>)}
        </div>}
      </aside>
    </div>
  </div>;
}
