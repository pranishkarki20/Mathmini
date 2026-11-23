import { useEffect, useMemo } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { divIcon, type Layer, type PathOptions } from 'leaflet';
import type { Feature as GeoFeature, Geometry } from 'geojson';
import type { Incident, NetworkData, RoadProperties, RouteSegment, SensorResult, SensorSite, TrafficRoad } from '../api';

type Props = {
  network: NetworkData; route?: RouteSegment[]; incidents?: Incident[]; sensors?: SensorResult | null; sensorSites?: SensorSite[];
  selectedRoad?: TrafficRoad | null; onRoadSelect?: (road: TrafficRoad) => void; onJunctionSelect?: (code: string) => void;
  filterConditions?: string[]; showSensors?: boolean; compact?: boolean;
};
const colors: Record<string, string> = { normal: '#37c89a', moderate: '#e6cb55', heavy: '#ec9b45', severe: '#e55d66', closed: '#8892a0', unobserved: '#7388a5', simulated: '#59b9d4' };
function FitCorridor({ junctions }: { junctions: NetworkData['junctions'] }) {
  const map = useMap();
  useEffect(() => { if (junctions.length > 1) map.fitBounds(junctions.map((point) => [point.lat, point.lon] as [number, number]), { padding: [25, 25] }); }, [map, junctions]);
  return null;
}

export default function TrafficMap({ network, route = [], incidents = [], sensors, sensorSites = [], selectedRoad, onRoadSelect, onJunctionSelect, filterConditions = [], showSensors = false, compact = false }: Props) {
  const trafficLookup = useMemo(() => new Map(network.traffic.map((road) => [road.roadId, road])), [network.traffic]);
  const selectedIds = new Set(route.map((segment) => segment.roadId));
  const sensorLookup = useMemo(() => new Map(sensorSites.map((site) => [site.code, site])), [sensorSites]);
  const mapKey = `${network.source}:${network.updatedAt}:${[...filterConditions].sort().join(',')}:${selectedRoad?.roadId ?? ''}`;
  const createJunctionIcon = (code: string) => divIcon({ className: 'junction-icon-wrap', html: `<span class="junction-map-marker"><b>${code}</b></span>`, iconSize: [27, 27], iconAnchor: [13, 13] });
  const roadStyle = (feature?: GeoFeature<Geometry, RoadProperties>): PathOptions => {
    const props = feature?.properties;
    const data = props ? trafficLookup.get(props.roadId) : undefined;
    const condition = data?.condition ?? props?.condition ?? 'unobserved';
    const visible = !filterConditions.length || filterConditions.includes(condition) || (filterConditions.includes('open') && !data?.closed);
    const selected = selectedRoad?.roadId === props?.roadId;
    const inRoute = props ? selectedIds.has(props.roadId) : false;
    return { color: data?.closed ? colors.closed : inRoute ? '#3de3b3' : selected ? '#ffffff' : colors[condition] ?? colors.unobserved,
      weight: inRoute ? 7 : selected ? 6 : Math.max(2, Math.min(5, Number(props?.highway === 'motorway' ? 5 : props?.highway === 'primary' ? 4 : 3))),
      opacity: visible ? inRoute || selected ? 1 : .8 : 0, dashArray: data?.closed ? '7 8' : undefined, lineCap: 'round', lineJoin: 'round' };
  };
  const roadClick = (feature: GeoFeature<Geometry, RoadProperties>, layer: Layer) => {
    layer.on('click', () => {
      const props = feature.properties;
      const data = trafficLookup.get(props.roadId) ?? { roadId: props.roadId, name: props.name, speedKph: props.speedKph, condition: props.condition, distanceM: props.distanceM, estimatedTravelTimeMinutes: props.estimatedTravelTimeMinutes ?? 0, source: props.dataSource ?? props.source ?? network.sourceLabel, isSimulated: props.isSimulated ?? !network.isLiveTraffic, lastUpdated: props.lastUpdated ?? network.updatedAt, closed: !!props.closed } as TrafficRoad;
      onRoadSelect?.(data);
    });
    layer.bindTooltip(feature.properties.name || 'Unnamed road', { sticky: true, className: 'road-tooltip' });
  };

  return <div className={`leaflet-map-shell ${compact ? 'leaflet-map-compact' : ''}`}>
    <MapContainer center={[12.9265, 77.6655]} zoom={13} minZoom={11} maxZoom={19} scrollWheelZoom className="leaflet-map" zoomControl>
      <TileLayer attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a>" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitCorridor junctions={network.junctions} />
      <GeoJSON key={mapKey} data={network.geojson as never} style={roadStyle as never} onEachFeature={roadClick as never} />
      {route.map((segment, index) => <Polyline key={`route-outline-${index}`} positions={segment.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: '#09251e', weight: 10, opacity: .85, lineCap: 'round' }} />)}
      {route.map((segment, index) => <Polyline key={`route-${index}`} positions={segment.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: '#43e1b2', weight: 6, opacity: .98, lineCap: 'round' }} />)}
      {showSensors && sensors?.edges.map((edge) => {
        const a = sensorLookup.get(edge.a); const b = sensorLookup.get(edge.b);
        if (!a || !b) return null;
        return <Polyline key={`sensor-${edge.id}`} positions={[[a.latitude, a.longitude], [b.latitude, b.longitude]]} pathOptions={{ color: '#b396ff', weight: 4, opacity: .92, dashArray: '8 6' }} />;
      })}
      {network.junctions.map((junction) => <Marker key={junction.code} position={[junction.lat, junction.lon]} icon={createJunctionIcon(junction.code)} eventHandlers={{ click: () => onJunctionSelect?.(junction.code) }}><Tooltip direction="bottom" offset={[0, 8]}>{junction.name}</Tooltip><Popup><div className="map-popup"><b>{junction.code} · {junction.name}</b><span>Corridor study junction</span><button onClick={() => onJunctionSelect?.(junction.code)}>Use as trip location</button></div></Popup></Marker>)}
      {incidents.filter((incident) => incident.status === 'active').map((incident) => <CircleMarker key={incident.id} center={[incident.latitude, incident.longitude]} radius={incident.severity === 'critical' ? 10 : 8} pathOptions={{ color: '#ff9b74', fillColor: '#e85c62', fillOpacity: .93, weight: 2 }}><Popup><div className="map-popup"><b>{incident.kind.replace('_', ' ')} · {incident.severity}</b><span>{incident.location_name}</span><p>{incident.description}</p></div></Popup></CircleMarker>)}
    </MapContainer>
    <div className="map-source-pill"><span className={network.source === 'openstreetmap' ? 'source-ok' : 'source-model'} />{network.source === 'openstreetmap' ? 'OSM ROAD GEOMETRY' : 'CORRIDOR MODEL'}</div>
  </div>;
}
