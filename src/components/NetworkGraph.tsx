import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { locationById, pointDefaults, type NodeId, type Road } from '../data/network';

type Point = { x: number; y: number };
type Props = {
  roads: Road[]; route?: NodeId[]; tree?: Road[]; current?: NodeId | null; visited?: NodeId[];
  root?: NodeId; rootedLevels?: Partial<Record<NodeId, number>>; onRoadClick?: (road: Road) => void;
  onNodeClick?: (id: NodeId) => void; selectedNode?: NodeId; positions?: Record<NodeId, Point>; onPositionsChange?: (positions: Record<NodeId, Point>) => void;
  closuresMode?: boolean;
};
const isOnPath = (road: Road, path: NodeId[]) => path.some((id, index) => index < path.length - 1 && ((id === road.a && path[index + 1] === road.b) || (id === road.b && path[index + 1] === road.a)));

export default function NetworkGraph({ roads, route = [], tree = [], current, visited = [], root, rootedLevels, onRoadClick, onNodeClick, selectedNode, positions, onPositionsChange, closuresMode = false }: Props) {
  const points = positions ?? pointDefaults;
  const drag = useRef<{ id: NodeId; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<NodeId | null>(null);
  const moveNode = (event: ReactPointerEvent<SVGGElement>) => {
    if (!drag.current || !onPositionsChange) return;
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const x = Math.max(48, Math.min(730, ((event.clientX - rect.left) / rect.width) * 780));
    const y = Math.max(55, Math.min(385, ((event.clientY - rect.top) / rect.height) * 430));
    if (Math.abs(x - points[drag.current.id].x) + Math.abs(y - points[drag.current.id].y) > 2) drag.current.moved = true;
    onPositionsChange({ ...points, [drag.current.id]: { x, y } });
  };
  return <svg className="network-svg" viewBox="0 0 780 430" role="img" aria-label="Interactive schematic road network">
    <defs>
      <pattern id="dotGrid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#25364d" opacity=".45" /></pattern>
      <filter id="nodeShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#000" floodOpacity=".25" /></filter>
    </defs>
    <rect width="780" height="430" fill="url(#dotGrid)" />
    <path d="M 20 360 C 140 290, 90 180, 230 170 S 370 230, 445 145 S 580 95, 760 55" className="map-contour" />
    <path d="M 25 80 C 160 120, 160 260, 280 320 S 480 360, 750 390" className="map-contour map-contour-two" />
    {roads.map((road) => {
      const a = points[road.a]; const b = points[road.b];
      const midX = (a.x + b.x) / 2; const midY = (a.y + b.y) / 2;
      const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const offset = road.id.charCodeAt(0) % 2 === 0 ? 13 : -13;
      const labelX = midX + ((b.y - a.y) / distance) * offset;
      const labelY = midY - ((b.x - a.x) / distance) * offset;
      const onRoute = isOnPath(road, route); const onTree = tree.some((edge) => edge.id === road.id);
      return <g key={road.id} className={`road-edge ${!road.open ? 'is-closed' : ''} ${onRoute ? 'is-route' : ''} ${onTree ? 'is-tree' : ''} ${closuresMode ? 'can-toggle' : ''}`} onClick={() => onRoadClick?.(road)} role={onRoadClick ? 'button' : undefined} tabIndex={onRoadClick ? 0 : undefined} onKeyDown={(event) => { if (onRoadClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRoadClick(road); } }} aria-label={`${road.a} to ${road.b}, ${road.minutes} minutes, ${road.open ? 'open' : 'closed'}`}>
        <line className="edge-shadow" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line className="edge-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line className="edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        {(onRoute || onTree) && road.open && <line className="edge-overlay" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
        <g className="edge-weight" transform={`translate(${labelX},${labelY})`}><rect x="-27" y="-12" width="54" height="24" rx="8" /><text textAnchor="middle" dominantBaseline="central">{road.open ? `${road.minutes}m` : 'CLOSED'}</text></g>
      </g>;
    })}
    {Object.entries(points).map(([rawId, point]) => {
      const id = rawId as NodeId; const info = locationById[id];
      const isRoot = id === root; const level = rootedLevels?.[id];
      const degree = tree.filter((edge) => edge.a === id || edge.b === id).length;
      const roleClass = level === undefined ? '' : level === 0 ? 'node-root' : degree === 1 ? 'node-leaf' : 'node-internal';
      return <g key={id} className={`map-node ${selectedNode === id ? 'is-selected' : ''} ${current === id ? 'is-current' : ''} ${visited.includes(id) ? 'is-visited' : ''} ${roleClass}`} transform={`translate(${point.x},${point.y})`} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id, moved: false }; setDragging(id); }} onPointerMove={(event) => { if (drag.current?.id === id) moveNode(event); }} onPointerUp={(event) => { event.stopPropagation(); const moved = drag.current?.moved; drag.current = null; setDragging(null); if (!moved) onNodeClick?.(id); }} onPointerCancel={() => { drag.current = null; setDragging(null); }} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onNodeClick?.(id); }} aria-label={`${id}, ${info.name}. Drag to reposition or select for details.`}>
        <circle className="node-halo" r="31" />
        <circle className="node-circle" r="22" filter="url(#nodeShadow)" />
        <text className="node-id" textAnchor="middle" dominantBaseline="central">{id}</text>
        <text className="node-label" textAnchor="middle" y="42">{info.name}</text>
        {level !== undefined && <text className="node-level" textAnchor="middle" y="60">LEVEL {level}</text>}
        {dragging === id && <circle className="node-drag-ring" r="29" />}
        {isRoot && <circle className="root-indicator" cx="18" cy="-17" r="5" />}
      </g>;
    })}
  </svg>;
}
