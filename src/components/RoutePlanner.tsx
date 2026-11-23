import { useEffect, useState, type FormEvent } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { ArrowDownUp, ArrowRight, LocateFixed, MapPin, MousePointer2, RefreshCw, Route, Search } from 'lucide-react';
import { api, type OSMPlace, type OSRMRoute } from '../api';

type Point = { latitude: number; longitude: number; name: string; displayName: string; placeId?: string };

function SearchPlace({ label, point, onSelect, onSearch, busy, placeholder }: {
  label: string; point: Point | null; onSelect: (point: Point | null) => void; onSearch: (query: string) => Promise<OSMPlace[]>; busy: boolean; placeholder: string;
}) {
  const [query, setQuery] = useState(point?.name ?? '');
  const [results, setResults] = useState<OSMPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (point) setQuery(point.name); }, [point?.latitude, point?.longitude]);
  const search = async (event: FormEvent) => {
    event.preventDefault(); setSearching(true); setError('');
    try {
      const found = await onSearch(query);
      setResults(found);
      if (!found.length) setError('No matching OpenStreetMap places. Try a nearby street, city or landmark.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Place search failed. Try again.'); }
    finally { setSearching(false); }
  };
  const choose = (item: OSMPlace) => {
    onSelect({ latitude: item.latitude, longitude: item.longitude, name: item.name, displayName: item.displayName, placeId: item.placeId });
    setQuery(item.name); setResults([]); setError('');
  };
  return <div className="osm-search-place"><label>{label}</label><form onSubmit={search} className="osm-search-form"><input value={query} onChange={(event) => { setQuery(event.target.value); onSelect(null); }} placeholder={placeholder} aria-label={label} /><button type="submit" disabled={searching || busy || query.trim().length < 3} title="Search OpenStreetMap"><Search size={15} />{searching ? 'Searching' : 'Search'}</button></form>{point && <small className="osm-place-address"><MapPin size={12} />{point.displayName}</small>}{error && <small className="osm-search-error">{error}</small>}{results.length > 0 && <div className="osm-place-results" role="listbox">{results.map((item) => <button type="button" key={`${item.osmType}-${item.osmId}-${item.placeId}`} onClick={() => choose(item)}><b>{item.name}</b><small>{item.displayName}</small><span>{item.category}{item.type ? ` · ${item.type}` : ''}</span></button>)}</div>}</div>;
}

function FitRoute({ route, origin, destination }: { route?: OSRMRoute; origin?: Point | null; destination?: Point | null }) {
  const map = useMap();
  useEffect(() => {
    const coordinates = route?.geometry.coordinates ?? [];
    const positions = coordinates.length ? coordinates.map(([lon, lat]) => [lat, lon] as [number, number]) : [origin, destination].filter((point): point is Point => !!point).map((point) => [point.latitude, point.longitude] as [number, number]);
    if (positions.length > 1) map.fitBounds(positions, { padding: [36, 36] });
    else if (positions.length === 1) map.setView(positions[0], 14);
  }, [map, route, origin, destination]);
  return null;
}

function PickLocation({ active, onPick }: { active: boolean; onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({ click(event) { if (active) onPick(event.latlng.lat, event.latlng.lng); } });
  return null;
}

export default function RoutePlanner({ onRouteCalculated }: { onRouteCalculated?: (summary: string) => void }) {
  const [origin, setOrigin] = useState<Point | null>(null);
  const [destination, setDestination] = useState<Point | null>(null);
  const [routes, setRoutes] = useState<OSRMRoute[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const [mapPickTarget, setMapPickTarget] = useState<'origin' | 'destination' | null>(null);
  const [searchSource, setSearchSource] = useState('');

  const searchPlaces = async (query: string) => {
    if (query.trim().length < 3) throw new Error('Enter at least 3 characters to search.');
    setSearching(true);
    try {
      const result = await api.searchPlaces(query.trim());
      setSearchSource(result.source);
      return result.results;
    } finally { setSearching(false); }
  };
  const updateOrigin = (point: Point | null) => { setOrigin(point); setRoutes([]); setError(''); };
  const updateDestination = (point: Point | null) => { setDestination(point); setRoutes([]); setError(''); };
  const calculate = async () => {
    setError('');
    if (!origin || !destination) { setError('Search for and select both an origin and a destination.'); return; }
    setCalculating(true); setRoutes([]);
    try {
      const coordinates = [origin, destination].map(({ latitude, longitude }) => ({ latitude, longitude }));
      const result = await api.routeOSRM({ coordinates, alternatives: true });
      setRoutes(result.routes); setSelected(0);
      if (result.routes[0]) onRouteCalculated?.(`${origin.name} → ${destination.name} · ${(result.routes[0].distanceMeters / 1000).toFixed(1)} km · OSRM estimate`);
      if (!result.routes.length) setError('OSRM returned no route. Try different locations.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Route calculation failed. The selected places are preserved so you can retry.'); }
    finally { setCalculating(false); }
  };
  const swap = () => { setOrigin(destination); setDestination(origin); setRoutes([]); setError(''); };
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('This browser does not support location access.'); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude, name: 'Current location', displayName: 'Device coordinates · browser permission granted' };
      setOrigin(point); setMapPickTarget(null); setRoutes([]); setError('');
    }, (reason) => setError(reason.message || 'Location permission was not granted.'), { enableHighAccuracy: true, timeout: 10000 });
  };
  const pickFromMap = (latitude: number, longitude: number) => {
    const point = { latitude, longitude, name: 'Map pin', displayName: `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · selected from map` };
    if (mapPickTarget === 'origin') setOrigin(point); else setDestination(point);
    setMapPickTarget(null); setRoutes([]); setError('');
  };
  const selectedRoute = routes[selected];
  const mapCenter: [number, number] = origin ? [origin.latitude, origin.longitude] : [12.9716, 77.5946];

  return <div className="osm-route-planner"><header className="osm-route-heading"><div><span className="eyebrow">OPENSTREETMAP · OSRM</span><h2>Plan a route</h2><p>Search worldwide places in OpenStreetMap, then compare estimated driving routes.</p></div><span className="osm-data-badge"><i />OSM PLACE SEARCH · OSRM ROUTING</span></header><div className="osm-route-layout"><section className="surface osm-route-sidebar"><div className="osm-route-form"><div className="osm-route-point"><SearchPlace label="Starting location" point={origin} onSelect={updateOrigin} onSearch={searchPlaces} busy={searching || calculating} placeholder="City, address, landmark…" /><SearchPlace label="Destination" point={destination} onSelect={updateDestination} onSearch={searchPlaces} busy={searching || calculating} placeholder="Search any OSM place…" /><button className="osm-swap-button" type="button" onClick={swap} aria-label="Swap origin and destination"><ArrowDownUp size={14} /> Swap</button></div><button className="osm-current-location" type="button" onClick={useCurrentLocation}><LocateFixed size={14} />Use my current location <small>Requires browser permission</small></button><button type="button" className="button button-primary button-wide osm-find-route" onClick={() => void calculate()} disabled={calculating || !origin || !destination}>{calculating ? <><RefreshCw className="spin" size={14} /> Finding route…</> : <><Route size={15} /> Find route <ArrowRight size={14} /></>}</button></div>
    <div className="osm-map-pin-controls"><span><MousePointer2 size={13} /> Set a point by clicking the map</span><div><button type="button" className={mapPickTarget === 'origin' ? 'selected' : ''} onClick={() => setMapPickTarget(mapPickTarget === 'origin' ? null : 'origin')}>Origin</button><button type="button" className={mapPickTarget === 'destination' ? 'selected' : ''} onClick={() => setMapPickTarget(mapPickTarget === 'destination' ? null : 'destination')}>Destination</button></div></div>
    {error && <div className="osm-route-error" role="alert">{error}</div>}{searchSource && <small className="osm-search-source">Search source: {searchSource}</small>}
    {selectedRoute && <section className="osm-route-details"><div className="osm-route-summary"><div><span>DISTANCE</span><b>{(selectedRoute.distanceMeters / 1000).toFixed(1)} km</b></div><div><span>ESTIMATED DRIVE</span><b>{Math.round(selectedRoute.durationSeconds / 60)} min</b></div></div><div className="osm-route-source"><b>Route estimate · OSRM</b><small>Retrieved {new Date(selectedRoute.retrievedAt).toLocaleString()}</small><span>Traffic is not included. No live traffic data is available from this route response.</span></div><details className="osm-directions"><summary>Route directions</summary><ol>{selectedRoute.legs.flatMap((leg) => leg.steps).filter((step) => step.name || step.type).map((step, index) => <li key={`${index}-${step.name}`}>{step.type.replaceAll('_', ' ')}{step.modifier ? ` ${step.modifier}` : ''}{step.name ? ` onto ${step.name}` : ''}<small>{(step.distanceMeters / 1000).toFixed(2)} km</small></li>)}</ol></details></section>}
    </section><section className="osm-map-panel"><div className="osm-map-header"><span><MapPin size={15} />{mapPickTarget ? `Click map to set ${mapPickTarget}` : 'Road map'}</span><small>© OpenStreetMap contributors</small></div><div className={`osm-map-canvas ${mapPickTarget ? 'map-picking' : ''}`}><MapContainer center={mapCenter} zoom={11} scrollWheelZoom className="osm-route-map"><TileLayer attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" /><PickLocation active={!!mapPickTarget} onPick={pickFromMap} /><FitRoute route={selectedRoute} origin={origin} destination={destination} />{routes.map((route, index) => <Polyline key={route.id} positions={route.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: index === selected ? '#1677ff' : '#8796aa', weight: index === selected ? 7 : 5, opacity: index === selected ? .95 : .67 }} eventHandlers={{ click: () => setSelected(index) }} />)}{origin && <CircleMarker center={[origin.latitude, origin.longitude]} radius={8} pathOptions={{ color: '#fff', fillColor: '#23a879', fillOpacity: 1, weight: 3 }}><Popup><b>Start · {origin.name}</b></Popup></CircleMarker>}{destination && <CircleMarker center={[destination.latitude, destination.longitude]} radius={8} pathOptions={{ color: '#fff', fillColor: '#d84e5f', fillOpacity: 1, weight: 3 }}><Popup><b>Destination · {destination.name}</b></Popup></CircleMarker>}</MapContainer></div>{routes.length > 0 && <div className="osm-alternatives"><div className="osm-alternative-heading"><b>Route options</b><small>{routes.length} returned by OSRM · click an option or map line</small></div>{routes.map((route, index) => <button type="button" key={route.id} className={`osm-alternative ${index === selected ? 'selected' : ''}`} onClick={() => setSelected(index)}><i style={{ background: index === selected ? '#1677ff' : '#8796aa' }} /><span><b>{index === 0 ? 'Recommended' : `Alternative ${index}`}</b><small>{(route.distanceMeters / 1000).toFixed(1)} km · {Math.round(route.durationSeconds / 60)} min</small></span><ArrowRight size={14} /></button>)}</div>}</section></div><footer className="osm-route-footer">Place search follows public Nominatim limits: searches happen only when submitted, results are cached, and requests are rate-limited. For a high-traffic production deployment, use a contracted or self-hosted geocoder and OSRM instance.</footer></div>;
}
