import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, BarChart3,
  BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp, Compass,
  GitBranch, Grid2X2, Info, Layers3, Map, Menu, MousePointer2, Network,
  Pause, Play, RotateCcw, Route, ShieldCheck, Sparkles,
  TreePine, TrafficCone, X, Zap, type LucideIcon,
} from 'lucide-react';
import NetworkGraph from './components/NetworkGraph';
import { initialRoads, locationById, locations, nodeIds, pointDefaults, type NodeId, type Road } from './data/network';
import { breadthFirstPath, dijkstra, kruskal, pathMinutes, prim, rootTree } from './algorithms/graph';

const AnalyticsCharts = lazy(() => import('./components/AnalyticsCharts'));

type View = 'overview' | 'route' | 'trees' | 'closures' | 'rooted' | 'analytics' | 'learn';
type Strategy = 'dijkstra' | 'bfs';
type Point = { x: number; y: number };
const navItems: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: Grid2X2 },
  { id: 'route', label: 'Route finder', icon: Route },
  { id: 'trees', label: 'Spanning trees', icon: GitBranch },
  { id: 'closures', label: 'Road closures', icon: TrafficCone },
  { id: 'rooted', label: 'Rooted tree', icon: TreePine },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'learn', label: 'Graph theory guide', icon: BookOpen },
];
const slides = [
  { title: 'Smart City Traffic Network Optimization', kicker: 'INTRODUCTION', body: 'A graph theory simulation for exploring how road networks can be represented, analyzed, and optimized. Every travel time shown is an assumed model value.', view: 'overview' as View },
  { title: 'A weighted graph of seven junctions', kicker: 'ROAD NETWORK', body: 'Junctions are vertices. Two-way road connections are edges. Each edge weight is an assumed travel time in minutes.', view: 'overview' as View },
  { title: 'Find the fastest route with Dijkstra', kicker: 'SHORTEST PATH', body: 'For Silk Board to Marathahalli, the computed path is A → C → B → D → E → F → G with a total of 17 minutes.', view: 'route' as View },
  { title: 'Kruskal builds a minimum spanning tree', kicker: 'MINIMUM SPANNING TREE', body: 'Sort the edges by weight, then accept an edge only when it joins two different components. A cycle-forming edge is skipped.', view: 'trees' as View },
  { title: 'Prim grows a tree from a start junction', kicker: 'MINIMUM SPANNING TREE', body: 'Starting at A, repeatedly choose the cheapest edge leaving the current tree. Both MST algorithms return a total weight of 17.', view: 'trees' as View },
  { title: 'Simulate a road closure', kicker: 'RESILIENCE', body: 'Close B–D to remove that edge from the network. Dijkstra recalculates routes using only roads that remain open.', view: 'closures' as View },
  { title: 'Root the tree at Ibbaluru', kicker: 'TREE STRUCTURE', body: 'With D as the root, the spanning tree has height 3. Every other junction is grouped by its number of tree edges from D.', view: 'rooted' as View },
  { title: 'Shortest path and MST solve different problems', kicker: 'CONCLUSION', body: 'Dijkstra connects one origin to one destination as efficiently as possible. A minimum spanning tree connects every vertex with minimum total edge weight.', view: 'learn' as View },
];
const fmt = (n: number) => Number.isFinite(n) ? `${n} min` : 'No route';
const routeLabel = (path: NodeId[]) => path.length ? path.join(' → ') : 'No open route';

export default function App() {
  const [view, setView] = useState<View>('overview');
  const [roads, setRoads] = useState<Road[]>(initialRoads.map((road) => ({ ...road })));
  const [start, setStart] = useState<NodeId>('A');
  const [destination, setDestination] = useState<NodeId>('G');
  const [strategy, setStrategy] = useState<Strategy>('dijkstra');
  const [dStep, setDStep] = useState(0);
  const [treeAlgorithm, setTreeAlgorithm] = useState<'kruskal' | 'prim'>('kruskal');
  const [treeStart, setTreeStart] = useState<NodeId>('A');
  const [treeStep, setTreeStep] = useState(0);
  const [root, setRoot] = useState<NodeId>('D');
  const [selectedNode, setSelectedNode] = useState<NodeId | undefined>();
  const [positions, setPositions] = useState<Record<NodeId, Point>>(pointDefaults);
  const [presentation, setPresentation] = useState(false);
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');

  const route = useMemo(() => strategy === 'dijkstra' ? dijkstra(roads, start, destination) : null, [roads, start, destination, strategy]);
  const bfsPath = useMemo(() => breadthFirstPath(roads, start, destination), [roads, start, destination]);
  const selectedPath = strategy === 'dijkstra' ? route!.path : bfsPath;
  const baseline = useMemo(() => dijkstra(initialRoads, start, destination), [start, destination]);
  const minimumTree = useMemo(() => kruskal(roads), [roads]);
  const primTree = useMemo(() => prim(roads, treeStart), [roads, treeStart]);
  const activeTree = treeAlgorithm === 'kruskal' ? minimumTree : primTree;
  const visibleTreeEdges = treeAlgorithm === 'kruskal'
    ? activeTree.steps.slice(0, treeStep).filter((step) => step.accepted).map((step) => step.edge)
    : activeTree.edges.slice(0, treeStep);
  const rooted = useMemo(() => rootTree(minimumTree.edges, root), [minimumTree.edges, root]);
  const originalWeight = initialRoads.reduce((sum, road) => sum + road.minutes, 0);
  const savings = minimumTree.complete ? ((1 - minimumTree.total / originalWeight) * 100) : null;
  const dijkstraProgress = route?.steps[Math.min(dStep, Math.max(0, (route?.steps.length ?? 1) - 1))];
  const activeView = presentation ? slides[slide].view : view;

  useEffect(() => { setDStep(0); }, [start, destination, roads]);
  useEffect(() => { setTreeStep(0); }, [treeAlgorithm, treeStart, roads]);
  useEffect(() => {
    if (!playing) return;
    const maxStep = treeAlgorithm === 'kruskal' ? activeTree.steps.length : activeTree.edges.length;
    if (treeStep >= maxStep) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setTreeStep((step) => step + 1), 650);
    return () => window.clearTimeout(timer);
  }, [playing, treeStep, treeAlgorithm, activeTree.steps.length, activeTree.edges.length]);
  useEffect(() => {
    if (!presentation || !playing) return;
    const timer = window.setTimeout(() => setSlide((current) => {
      if (current >= slides.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 4500);
    return () => window.clearTimeout(timer);
  }, [presentation, playing, slide]);

  function toggleRoad(road: Road) {
    setRoads((current) => current.map((candidate) => candidate.id === road.id ? { ...candidate, open: !candidate.open } : candidate));
    setNotice(`${road.a}–${road.b} ${road.open ? 'closed' : 'reopened'} · route calculations updated`);
    window.setTimeout(() => setNotice(''), 3600);
  }
  function resetSimulation() {
    setRoads(initialRoads.map((road) => ({ ...road })));
    setPositions(pointDefaults); setSelectedNode(undefined); setNotice('Network reset to the original simulation data.');
    window.setTimeout(() => setNotice(''), 3600);
  }
  function openPresentation() { setView('overview'); setSlide(0); setPresentation(true); setPlaying(false); }
  function changeView(next: View) { setView(next); setMobileNav(false); setSelectedNode(undefined); }
  function sectionTitle() { return navItems.find((item) => item.id === activeView)?.label ?? 'Overview'; }

  const routeCurrent = strategy === 'dijkstra' ? dijkstraProgress?.current : undefined;
  const routeVisited = strategy === 'dijkstra' ? dijkstraProgress?.visited ?? [] : [];
  const map = (options: { roadsOverride?: Road[]; route?: NodeId[]; tree?: Road[]; current?: NodeId | null; visited?: NodeId[]; root?: NodeId; levels?: Partial<Record<NodeId, number>>; closures?: boolean } = {}) => <NetworkGraph
    roads={options.roadsOverride ?? roads} route={options.route} tree={options.tree} current={options.current} visited={options.visited}
    root={options.root} rootedLevels={options.levels} onRoadClick={options.closures ? toggleRoad : undefined}
    onNodeClick={setSelectedNode} selectedNode={selectedNode} positions={positions} onPositionsChange={setPositions} closuresMode={options.closures}
  />;

  const locationSelect = (value: NodeId, onChange: (value: NodeId) => void, label: string) => <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as NodeId)}>{locations.map((location) => <option value={location.id} key={location.id}>{location.id} · {location.name}</option>)}</select></label>;

  function statCard(label: string, value: string | number, helper: string, icon: LucideIcon, tone: string) {
    const Icon = icon;
    return <article className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={18} /></div><div className="stat-copy"><span>{label}</span><strong>{value}</strong><small>{helper}</small></div></article>;
  }

  function nodeInfo() {
    if (!selectedNode) return null;
    const connected = roads.filter((road) => road.a === selectedNode || road.b === selectedNode);
    const info = locationById[selectedNode];
    return <div className="node-detail"><div><span className="node-detail-id">{selectedNode}</span><div><strong>{info.name}</strong><small>{info.area}</small></div></div><span className="node-detail-count">{connected.length} roads</span><button className="icon-button" onClick={() => setSelectedNode(undefined)} aria-label="Close junction details"><X size={15} /></button><div className="connected-roads">{connected.map((road) => <span key={road.id} className={!road.open ? 'closed-text' : ''}>{road.a === selectedNode ? road.b : road.a} · {road.open ? `${road.minutes} min` : 'closed'}</span>)}</div></div>;
  }

  function mapPanel(options: { title?: string; subtitle?: string; route?: NodeId[]; tree?: Road[]; current?: NodeId | null; visited?: NodeId[]; root?: NodeId; levels?: Partial<Record<NodeId, number>>; closures?: boolean; large?: boolean }) {
    return <section className={`panel map-panel ${options.large ? 'map-panel-large' : ''}`}>
      <div className="panel-heading"><div><div className="panel-title-line"><h2>{options.title ?? 'Network map'}</h2><span className="live-badge"><i /> SIMULATION</span></div><p>{options.subtitle ?? 'Simplified road graph · Silk Board to Marathahalli'}</p></div><div className="map-help"><MousePointer2 size={14} /> Drag junctions to reposition <span>·</span> Select a node for details</div></div>
      <div className="map-stage">{map({ route: options.route, tree: options.tree, current: options.current, visited: options.visited, root: options.root, levels: options.levels, closures: options.closures })}<div className="map-compass"><Compass size={18} /><span>N</span></div><div className="map-scale"><span /><small>Schematic · not to scale</small></div></div>
      <div className="map-legend"><span><i className="legend-road" />Road</span><span><i className="legend-route" />Selected route</span><span><i className="legend-tree" />Spanning tree</span><span><i className="legend-closed" />Closed road</span></div>
      {nodeInfo()}
    </section>;
  }

  function routeCard(compact = false) {
    const currentRoute = strategy === 'dijkstra' ? route!.path : bfsPath;
    const currentTime = pathMinutes(roads, currentRoute);
    const delta = Number.isFinite(currentTime) && Number.isFinite(baseline.distance) ? currentTime - baseline.distance : null;
    return <div className={`route-summary ${compact ? 'route-summary-compact' : ''}`}>
      <div className="route-summary-head"><div><span className="section-eyebrow">{strategy === 'dijkstra' ? 'FASTEST ROUTE · DIJKSTRA' : 'FEWEST ROAD SEGMENTS · BFS'}</span><h3>{fmt(currentTime)}</h3></div><div className="route-summary-badge"><Route size={17} /></div></div>
      {currentRoute.length ? <><div className="route-sequence">{currentRoute.map((id, index) => <span key={`${id}-${index}`} className="route-stop"><b>{id}</b><small>{locationById[id].name}</small>{index < currentRoute.length - 1 && <i />}</span>)}</div><div className="route-summary-foot"><span>{currentRoute.length - 1} road segments</span><span>{Math.max(0, currentRoute.length - 2)} junctions passed</span>{delta !== null && <span className={delta > 0 ? 'delta-bad' : 'delta-good'}>{delta > 0 ? '+' : ''}{delta} min vs. open network</span>}</div></> : <div className="no-route"><Info size={16} /> No open route connects these junctions. Reopen a road or select another destination.</div>}
    </div>;
  }

  function routeControls() {
    return <div className="route-controls">
      <div className="field-row">{locationSelect(start, (value) => { setStart(value); setDStep(0); }, 'Starting junction')}{locationSelect(destination, (value) => { setDestination(value); setDStep(0); }, 'Destination')}</div>
      <label className="field"><span>Optimization objective</span><select value={strategy} onChange={(event) => { setStrategy(event.target.value as Strategy); setDStep(0); }}><option value="dijkstra">Fastest travel time · Dijkstra</option><option value="bfs">Fewest road segments · BFS</option></select></label>
      <button className="button button-primary full-button" onClick={() => { setDStep(0); setNotice(`${strategy === 'dijkstra' ? 'Dijkstra' : 'Breadth-first search'} recalculated ${start} → ${destination}.`); window.setTimeout(() => setNotice(''), 3000); }}><Route size={16} /> Find best route <ArrowRight size={16} /></button>
    </div>;
  }

  function dijkstraPanel() {
    const steps = route?.steps ?? [];
    const step = steps[Math.min(dStep, Math.max(steps.length - 1, 0))];
    return <section className="panel algorithm-panel">
      <div className="panel-heading compact-heading"><div><span className="section-eyebrow">ROUTE OPTIMIZATION</span><h2>Find your route</h2><p>Choose the trip endpoints and what matters most for this journey.</p></div><span className="algorithm-chip"><Zap size={14} /> {strategy === 'dijkstra' ? 'Dijkstra' : 'Breadth-first search'}</span></div>
      {routeControls()}
      {routeCard()}
      {strategy === 'dijkstra' && <div className="execution-panel"><div className="execution-head"><div><span className="section-eyebrow">ALGORITHM TRACE</span><strong>Dijkstra execution</strong></div><span className="step-counter">{steps.length ? Math.min(dStep + 1, steps.length) : 0}<i>/</i>{steps.length || 0}</span></div>
        <div className="execution-progress"><span style={{ width: `${steps.length ? Math.min(100, ((dStep + 1) / steps.length) * 100) : 0}%` }} /></div>
        <div className="execution-current"><div className="execution-current-icon"><Activity size={17} /></div><p>{step ? <>Visit <b>{step.current} · {locationById[step.current].name}</b> — current distance {fmt(step.distances[step.current])}</> : 'No reachable junctions to process.'}</p></div>
        <div className="distance-list">{nodeIds.map((id) => <div key={id} className={`${step?.current === id ? 'distance-current' : ''} ${step?.visited.includes(id) ? 'distance-visited' : ''}`}><span><i>{id}</i>{locationById[id].name}</span><b>{step && Number.isFinite(step.distances[id]) ? `${step.distances[id]}m` : id === start ? '0m' : '∞'}</b></div>)}</div>
        <div className="execution-actions"><button className="button button-subtle" disabled={dStep <= 0} onClick={() => setDStep((value) => Math.max(0, value - 1))}><ChevronLeft size={16} /> Previous</button><span>Settled nodes: {step?.visited.length ?? 0} / 7</span><button className="button button-subtle" disabled={!steps.length || dStep >= steps.length - 1} onClick={() => setDStep((value) => Math.min(steps.length - 1, value + 1))}>Next step <ChevronRight size={16} /></button></div>
      </div>}
      {strategy === 'bfs' && <div className="info-callout"><Info size={16} /><span>BFS minimizes the number of road segments. The travel time shown is the total weight of that route; it may not be the fastest option.</span></div>}
    </section>;
  }

  function treePanel() {
    const steps = activeTree.steps;
    const shownCount = Math.min(treeStep, steps.length);
    const accepted = treeAlgorithm === 'kruskal' ? steps.slice(0, shownCount).filter((step) => step.accepted) : steps.slice(0, shownCount);
    const shownRoads = accepted.map((step) => 'edge' in step ? step.edge : step);
    const sum = shownRoads.reduce((total, road) => total + road.minutes, 0);
    const completed = shownRoads.length === nodeIds.length - 1;
    return <section className="panel algorithm-panel">
      <div className="panel-heading compact-heading"><div><span className="section-eyebrow">NETWORK BACKBONE</span><h2>Minimum spanning tree</h2><p>Connect all junctions with the lowest possible total edge weight.</p></div><span className="algorithm-chip"><Layers3 size={14} /> {minimumTree.complete ? 'Connected graph' : 'Disconnected graph'}</span></div>
      <div className="segmented-control"><button className={treeAlgorithm === 'kruskal' ? 'selected' : ''} onClick={() => { setTreeAlgorithm('kruskal'); setTreeStep(0); setPlaying(false); }}>Kruskal <small>Union–Find</small></button><button className={treeAlgorithm === 'prim' ? 'selected' : ''} onClick={() => { setTreeAlgorithm('prim'); setTreeStep(0); setPlaying(false); }}>Prim <small>Grow from a start</small></button></div>
      {treeAlgorithm === 'prim' && <div className="field-row single-field">{locationSelect(treeStart, setTreeStart, 'Grow the tree from')}</div>}
      <div className="tree-stats"><div><span>TREE WEIGHT</span><b>{sum}</b><small>minutes</small></div><div><span>ROADS SELECTED</span><b>{shownRoads.length}<i>/ 6</i></b><small>required for a tree</small></div><div><span>NETWORK STATUS</span><b className={activeTree.complete ? 'text-green' : 'text-red'}>{activeTree.complete ? 'Connected' : 'Split'}</b><small>{activeTree.complete ? 'all 7 junctions' : `${new Set(shownRoads.flatMap((road) => [road.a, road.b])).size} reachable so far`}</small></div></div>
      <div className="step-toolbar"><button className="button button-subtle" disabled={treeStep <= 0} onClick={() => setTreeStep((n) => Math.max(0, n - 1))}><ChevronLeft size={16} /> Back</button><div className="step-dots">{steps.map((step, index) => <i key={`${step.edge.id}-${index}`} className={index < treeStep ? step.accepted ? 'accepted' : 'rejected' : ''} title={`${step.edge.id}: ${step.reason}`} />)}</div><button className="button button-primary" disabled={completed || !steps.length} onClick={() => setTreeStep((n) => Math.min(steps.length, n + 1))}>Add next edge <ChevronRight size={16} /></button><button className="icon-button" onClick={() => setTreeStep(0)} title="Reset tree steps"><RotateCcw size={15} /></button></div>
      <div className="tree-step-list">{steps.map((step, index) => <div key={`${step.edge.id}-${index}`} className={`tree-step ${index < treeStep ? step.accepted ? 'step-accepted' : 'step-rejected' : ''} ${index === treeStep - 1 ? 'step-active' : ''}`}><span className="tree-step-index">{String(index + 1).padStart(2, '0')}</span><span className="tree-edge-name">{step.edge.a}—{step.edge.b}<small>{locationById[step.edge.a].name} to {locationById[step.edge.b].name}</small></span><strong>{step.edge.minutes} min</strong><span className={`decision ${index < treeStep ? step.accepted ? 'decision-accept' : 'decision-reject' : ''}`}>{index < treeStep ? step.accepted ? <><Check size={13} /> Kept</> : 'Cycle' : 'Pending'}</span></div>)}</div>
      <div className="info-callout"><Info size={16} /><span>{treeAlgorithm === 'kruskal' ? 'Kruskal sorts the open roads from lightest to heaviest and uses Union–Find to reject cycle-forming edges.' : `Prim starts at ${treeStart} and repeatedly adds the cheapest road that reaches a new junction.`} The minimum spanning tree is an infrastructure backbone, not a fastest trip route.</span></div>
    </section>;
  }

  function closurePanel() {
    const change = Number.isFinite(route!.distance) && Number.isFinite(baseline.distance) ? route!.distance - baseline.distance : null;
    return <section className="panel closure-panel"><div className="panel-heading compact-heading"><div><span className="section-eyebrow">WHAT-IF SCENARIOS</span><h2>Road closure simulator</h2><p>Toggle a road to model a disruption. Routes and network algorithms recalculate automatically.</p></div><button className="button button-subtle" onClick={resetSimulation}><RotateCcw size={15} /> Reset simulation</button></div>
      <div className="closure-impact"><div className="impact-symbol"><TrafficCone size={20} /></div><div><span>FASTEST A → G RIGHT NOW</span><strong>{fmt(dijkstra(roads, 'A', 'G').distance)}</strong><small>{change !== null ? `${change > 0 ? '+' : ''}${change} min from the all-open baseline` : 'The destination is unreachable'}</small></div><div className={`impact-state ${minimumTree.complete ? 'connected' : 'disconnected'}`}><i />{minimumTree.complete ? 'Network connected' : 'Network disconnected'}</div></div>
      <div className="closure-layout"><div className="road-list">{roads.map((road) => <div key={road.id} className={`road-row ${road.open ? '' : 'road-row-closed'}`}><div className="road-route-icon"><span>{road.a}</span><i /><span>{road.b}</span></div><div className="road-row-name"><strong>{locationById[road.a].name} <span>↔</span> {locationById[road.b].name}</strong><small>{road.minutes} min · road {road.id}</small></div><button className={`toggle ${road.open ? 'toggle-on' : ''}`} role="switch" aria-checked={road.open} aria-label={`${road.open ? 'Close' : 'Open'} road ${road.id}`} onClick={() => toggleRoad(road)}><i /></button></div>)}</div><div className="closure-side"><div className="closure-route-card"><span className="section-eyebrow">CURRENT OPTIMAL ROUTE</span><strong>{fmt(dijkstra(roads, 'A', 'G').distance)}</strong><p>{routeLabel(dijkstra(roads, 'A', 'G').path)}</p><div className="mini-road-chain">{dijkstra(roads, 'A', 'G').path.slice(1).map((id, index) => <span key={`${id}-${index}`}>{dijkstra(roads, 'A', 'G').path[index]}—{id}</span>)}</div></div><div className="closure-tip"><Sparkles size={16} /><p><b>Try this test:</b> Close <b>B–D</b> (Agara to Ibbaluru). The fastest A-to-G route changes from 17 to 19 minutes.</p></div></div></div>
    </section>;
  }

  function rootedPanel() {
    const leaves = rooted.order.filter((id) => rooted.children[id].length === 0 && id !== root);
    const levelGroups = Array.from({ length: rooted.height + 1 }, (_, level) => ({ level, nodes: rooted.order.filter((id) => rooted.levels[id] === level) }));
    return <section className="panel rooted-panel"><div className="panel-heading compact-heading"><div><span className="section-eyebrow">TREE ORGANIZATION</span><h2>Rooted traffic hierarchy</h2><p>Choose any junction to orient the minimum spanning tree and calculate levels.</p></div>{locationSelect(root, setRoot, 'Root junction')}</div>
      <div className="root-summary"><div className="root-symbol"><TreePine size={22} /></div><div><span>TREE HEIGHT</span><strong>{minimumTree.complete ? rooted.height : '—'}</strong></div><div className="root-summary-divider" /><div><span>ROOT</span><strong>{root} · {locationById[root].name}</strong></div><div className="root-summary-divider" /><div><span>LEAF JUNCTIONS</span><strong>{leaves.length}</strong></div></div>
      {minimumTree.complete ? <div className="level-stack">{levelGroups.map(({ level, nodes }) => <div className="level-row" key={level}><div className="level-label"><span>LEVEL</span><strong>{level}</strong><small>{level === 0 ? 'root' : `${level} edge${level === 1 ? '' : 's'} away`}</small></div><div className="level-nodes">{nodes.map((id) => <div key={id} className={`level-node ${id === root ? 'root-node' : rooted.children[id].length === 0 ? 'leaf-node' : ''}`}><span>{id}</span><div><strong>{locationById[id].name}</strong><small>{rooted.parent[id] ? `Parent · ${rooted.parent[id]} ${locationById[rooted.parent[id]!].name}` : 'Root junction'}</small></div><div className="children-list">{rooted.children[id].length ? <>Children <b>{rooted.children[id].join(', ')}</b></> : <span className="leaf-tag">LEAF</span>}</div></div>)}</div></div>)}</div> : <div className="empty-state"><Network size={22} /> The open network is disconnected, so a spanning tree cannot reach every junction.</div>}
      <div className="info-callout"><Info size={16} /><span>Rooting changes the parent, child, and level labels. It does not change the spanning-tree edges or their total weight.</span></div>
    </section>;
  }

  function analyticsPanel() {
    const edgeData = initialRoads.map((road) => ({ road: road.id, minutes: road.minutes, open: roads.find((item) => item.id === road.id)?.open ?? false })).sort((a, b) => a.minutes - b.minutes || a.road.localeCompare(b.road));
    const journey = dijkstra(roads, 'A', 'G');
    const compare = [{ name: 'Fastest · Dijkstra', minutes: journey.distance }, { name: 'A-B-D-F-G', minutes: pathMinutes(roads, ['A', 'B', 'D', 'F', 'G']) }, { name: 'A-C-E-G', minutes: pathMinutes(roads, ['A', 'C', 'E', 'G']) }];
    const totals = [{ name: 'Full network', weight: originalWeight }, { name: 'Minimum tree', weight: minimumTree.total }];
    const closure = initialRoads.map((road) => ({ name: road.id, impact: dijkstra(initialRoads.map((edge) => edge.id === road.id ? { ...edge, open: false } : edge), 'A', 'G').distance - dijkstra(initialRoads, 'A', 'G').distance }));
    return <section className="analytics-view"><div className="analytics-intro"><div><span className="section-eyebrow">NETWORK INTELLIGENCE</span><h2>Analytics & comparison</h2><p>Charts are calculated from the current simulation graph and its assumed travel times.</p></div><span className="live-badge"><i /> MODEL DATA</span></div><Suspense fallback={<div className="panel chart-loading">Preparing calculated charts…</div>}><AnalyticsCharts edgeData={edgeData} compare={compare} totals={totals} closure={closure} savings={savings} /></Suspense></section>;
  }
  function learningPanel() {
    const concepts = [
      ['Weighted graph', 'A network where edges carry values. Here, vertices are junctions and edge weights are assumed road travel times in minutes. Example: B–C has weight 1.'],
      ['Tree and spanning tree', 'A tree is connected and has no cycles. A spanning tree includes every vertex. Seven junctions therefore need exactly six tree edges.'],
      ['Minimum spanning tree', 'A spanning tree with the lowest possible total edge weight. Kruskal and Prim both find weight 17 on this sample graph, saving 67.9% versus all 11 roads.'],
      ['Dijkstra', 'Finds a minimum-total-weight route from one source to other vertices when edge weights are non-negative. A to G is A → C → B → D → E → F → G = 17 minutes.'],
      ['Kruskal', 'Sort edges by weight and use Union–Find to accept edges that connect separate components. Reject an edge if it creates a cycle.'],
      ['Prim', 'Start with one vertex, then grow one connected tree by choosing its cheapest edge to an unvisited vertex.'],
      ['Rooted tree', 'Choose a vertex as the root. Levels count tree edges from that root. With D as root here, the tree height is 3.'],
      ['Why shortest path and MST differ', 'A shortest path connects one origin to one destination. An MST connects all vertices with minimum total edge weight. The shortest-path tree is not generally the minimum spanning tree.'],
    ];
    return <section className="learn-view"><div className="analytics-intro"><div><span className="section-eyebrow">DISCRETE MATHEMATICS · FIELD NOTES</span><h2>Graph theory, in this project</h2><p>Explore the ideas behind the dashboard, using its actual junctions and road weights.</p></div><BookOpen size={26} /></div><div className="concept-grid">{concepts.map(([title, body], index) => <article className="panel concept-card" key={title}><div className="concept-number">{String(index + 1).padStart(2, '0')}</div><h3>{title}</h3><p>{body}</p></article>)}</div><div className="scope-banner"><ShieldCheck size={20} /><div><strong>Academic simulation · not live navigation</strong><p>The map is schematic, roads are modeled as undirected, and travel times are assumed values. Real-world routing needs a mapped road graph and current validated travel-time data.</p></div></div><section className="panel validation-panel"><div className="chart-heading"><div><h3>Algorithm validation</h3><p>Expected outcomes recalculated from the model data</p></div><span className={`validation-total ${checklist.every((item) => item.value) ? 'all-valid' : ''}`}>{checklist.filter((item) => item.value).length} / {checklist.length} checks</span></div><div className="validation-grid">{checklist.map((item) => <div key={item.label} className={item.value ? 'validation-pass' : 'validation-fail'}><span>{item.value ? <Check size={14} /> : <X size={14} />}</span>{item.label}</div>)}</div></section></section>;
  }

  function overviewView() {
    const overallRoute = dijkstra(roads, 'A', 'G');
    const isClosed = roads.some((road) => !road.open);
    return <>
      <div className="overview-intro"><div><span className="section-eyebrow">BENGALURU · SILK BOARD ↔ MARATHAHALLI</span><h2>Traffic Network Optimization</h2><p>Explore how graph algorithms find efficient routes and resilient network backbones.</p></div><button className="button button-subtle" onClick={() => changeView('learn')}><CircleHelp size={15} /> Project guide</button></div>
      <div className="stat-grid">{statCard('Junctions', '07', 'Vertices in the model', Network, 'blue')}{statCard('Road links', '11', `${roads.filter((road) => road.open).length} currently open`, Map, 'cyan')}{statCard('Fastest A → G', fmt(overallRoute.distance), overallRoute.path.length ? routeLabel(overallRoute.path) : 'No open route', Zap, 'green')}{statCard('MST backbone', minimumTree.complete ? `${minimumTree.total} min` : '—', minimumTree.complete ? `${savings!.toFixed(1)}% less total weight` : 'Network disconnected', GitBranch, 'amber')}</div>
      <div className="overview-grid"><div>{mapPanel({ title: 'Interactive road network', subtitle: 'Silk Board to Marathahalli · schematic, not geographically accurate', route: overallRoute.path, large: true })}<div className="map-bottom-note"><Info size={14} /> {isClosed ? 'Road closures are active. Open the simulator to restore or change the network.' : 'Simulation uses assumed model times · No live traffic data'} <button onClick={() => changeView('closures')}>Manage roads <ArrowRight size={13} /></button></div></div><aside className="overview-side"><div className="panel quick-route"><div className="panel-heading compact-heading"><div><span className="section-eyebrow">QUICK ROUTE</span><h2>Plan a journey</h2></div><Route size={18} /></div><div className="quick-route-fields">{locationSelect(start, setStart, 'From')}{locationSelect(destination, setDestination, 'To')}</div><div className="quick-route-result"><div><span>FASTEST ROUTE</span><b>{fmt(overallRoute.distance)}</b></div><p>{routeLabel(overallRoute.path)}</p><button className="button button-primary full-button" onClick={() => changeView('route')}>Explore route <ArrowRight size={15} /></button></div></div>
        <div className="panel summary-panel"><div className="panel-heading compact-heading"><div><span className="section-eyebrow">NETWORK SNAPSHOT</span><h2>At a glance</h2></div><Activity size={18} /></div><div className="summary-line"><span>All-road weight</span><b>{originalWeight} min</b></div><div className="summary-line"><span>Minimum tree weight</span><b>{minimumTree.complete ? `${minimumTree.total} min` : 'Disconnected'}</b></div><div className="summary-line"><span>Possible weight savings</span><b className="text-green">{savings !== null ? `${savings.toFixed(1)}%` : '—'}</b></div><button className="text-button" onClick={() => changeView('analytics')}>View network analytics <ArrowRight size={14} /></button></div>
        <div className="learn-card"><div className="learn-card-icon"><Sparkles size={17} /></div><div><strong>Two problems, different tools</strong><p>Dijkstra finds a fast trip. An MST connects the whole network efficiently.</p><button className="text-button" onClick={() => changeView('learn')}>Learn the difference <ArrowRight size={13} /></button></div></div>
      </aside></div>
      <div className="overview-lower"><div><span className="section-eyebrow">ALGORITHM TOOLKIT</span><h2>Explore the network from every angle</h2></div><div className="toolkit-grid"><button className="toolkit-card" onClick={() => changeView('route')}><span className="toolkit-icon blue"><Route size={18} /></span><strong>Shortest path</strong><small>Compare Dijkstra and BFS</small><ArrowRight size={15} /></button><button className="toolkit-card" onClick={() => changeView('trees')}><span className="toolkit-icon green"><GitBranch size={18} /></span><strong>Spanning trees</strong><small>Explore Kruskal and Prim</small><ArrowRight size={15} /></button><button className="toolkit-card" onClick={() => changeView('closures')}><span className="toolkit-icon amber"><TrafficCone size={18} /></span><strong>Closure simulator</strong><small>Model a road disruption</small><ArrowRight size={15} /></button><button className="toolkit-card" onClick={() => changeView('rooted')}><span className="toolkit-icon purple"><TreePine size={18} /></span><strong>Rooted hierarchy</strong><small>Inspect levels and leaves</small><ArrowRight size={15} /></button></div></div>
    </>;
  }

  function renderView() {
    if (activeView === 'overview') return overviewView();
    if (activeView === 'route') return <div className="workspace-grid">{mapPanel({ title: 'Route visualization', subtitle: `${start} ${locationById[start].name} to ${destination} ${locationById[destination].name}`, route: selectedPath, current: routeCurrent, visited: routeVisited })}{dijkstraPanel()}</div>;
    if (activeView === 'trees') return <div className="workspace-grid">{mapPanel({ title: 'Spanning tree visualization', subtitle: `${treeAlgorithm === 'kruskal' ? 'Kruskal' : 'Prim'} · ${visibleTreeEdges.length} of 6 edges selected`, tree: visibleTreeEdges })}{treePanel()}</div>;
    if (activeView === 'closures') return <div className="closure-view"><div className="workspace-grid">{mapPanel({ title: 'Road closure map', subtitle: 'Click a road or use its toggle to open and close it', route: dijkstra(roads, 'A', 'G').path, closures: true })}{closurePanel()}</div></div>;
    if (activeView === 'rooted') return <div className="workspace-grid">{mapPanel({ title: 'Rooted tree map', subtitle: `Minimum spanning tree · rooted at ${root} ${locationById[root].name}`, tree: minimumTree.edges, root, levels: rooted.levels })}{rootedPanel()}</div>;
    if (activeView === 'analytics') return analyticsPanel();
    return learningPanel();
  }

  const presentationRoute = dijkstra(initialRoads, 'A', 'G');
  const validationRoute = dijkstra(initialRoads, 'A', 'G');
  const validationKruskal = kruskal(initialRoads);
  const validationPrim = prim(initialRoads, 'A');
  const closedBdNetwork = initialRoads.map((road) => road.id === 'BD' ? { ...road, open: false } : road);
  const closedBdRoute = dijkstra(closedBdNetwork, 'A', 'G');
  const allSingleClosuresAreSafe = initialRoads.every((closedRoad) => {
    const scenario = initialRoads.map((road) => road.id === closedRoad.id ? { ...road, open: false } : road);
    const result = dijkstra(scenario, 'A', 'G');
    return result.path.every((id, index) => index === 0 || scenario.some((road) => road.open && ((road.a === result.path[index - 1] && road.b === id) || (road.b === result.path[index - 1] && road.a === id))));
  });
  const checklist = [
    { label: 'Dijkstra A → G · path and 17 min', value: validationRoute.distance === 17 && validationRoute.path.join('') === 'ACBDEFG' },
    { label: 'Kruskal MST weight = 17', value: validationKruskal.total === 17 },
    { label: 'Prim MST weight = 17', value: validationPrim.total === 17 },
    { label: 'MST contains six roads', value: validationKruskal.edges.length === 6 },
    { label: 'Rooted tree at D · height 3', value: rootTree(validationKruskal.edges, 'D').height === 3 },
    { label: 'Close B–D · A → G = 19 min', value: closedBdRoute.distance === 19 },
    { label: 'Closed roads never appear in routes', value: allSingleClosuresAreSafe },
    { label: 'Alternative A–B–D–F–G = 19 min', value: pathMinutes(initialRoads, ['A', 'B', 'D', 'F', 'G']) === 19 },
    { label: 'Alternative A–C–E–G = 20 min', value: pathMinutes(initialRoads, ['A', 'C', 'E', 'G']) === 20 },
  ];

  return <div className={`app-shell ${presentation ? 'presentation-shell' : ''}`}>
    {!presentation && <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}><div className="brand"><div className="brand-mark"><Activity size={19} /></div><div><strong>FLOWSTATE</strong><small>GRAPH LAB</small></div><button className="sidebar-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div><div className="sidebar-label">WORKSPACE</div><nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'nav-active' : ''}`} onClick={() => changeView(id)}><Icon size={17} /><span>{label}</span>{view === id && <i />}</button>)}</nav><div className="sidebar-spacer" /><div className="sidebar-status"><span className="status-orb" /><div><strong>Simulation active</strong><small>Local model · no live feed</small></div></div><div className="sidebar-footer"><span>DISCRETE MATHEMATICS</span><small>University project prototype</small></div></aside>}
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumbs"><span>Flowstate</span><ChevronRight size={13} /><strong>{sectionTitle()}</strong></div></div><div className="topbar-right"><span className="simulation-pill"><i /> SIMULATION MODE</span><button className="button button-presentation" onClick={openPresentation}><Play size={14} fill="currentColor" /> Presentation mode</button><button className="avatar" title="Graph theory project">GT</button></div></header>
      <div className="page-content"><div className="page-kicker"><span>TRAFFIC NETWORK OPTIMIZATION</span><span className="page-kicker-line" /><span className="page-kicker-location">BENGALURU, INDIA</span></div>{renderView()}{notice && <div className="toast"><Check size={15} />{notice}</div>}<footer className="page-footer"><span>FLOWSTATE GRAPH LAB</span><span>Academic simulation · Assumed travel times · No live traffic feed</span><button onClick={() => changeView('learn')}>Method & assumptions <ArrowRight size={13} /></button></footer></div>
    </main>
    {mobileNav && !presentation && <button className="mobile-backdrop" onClick={() => setMobileNav(false)} aria-label="Close menu" />}
    {presentation && <div className="presentation-overlay"><header className="presentation-header"><div className="brand"><div className="brand-mark"><Activity size={19} /></div><div><strong>FLOWSTATE</strong><small>PROJECT PRESENTATION</small></div></div><div className="presentation-progress">{slides.map((item, index) => <i key={`${item.kicker}-${index}`} className={index <= slide ? 'done' : ''} />)}</div><button className="icon-button" onClick={() => { setPresentation(false); setPlaying(false); }} aria-label="Exit presentation"><X size={19} /></button></header><div className="presentation-content"><div className="presentation-copy"><span className="section-eyebrow">{slides[slide].kicker} · {String(slide + 1).padStart(2, '0')} / 08</span><h1>{slides[slide].title}</h1><p>{slides[slide].body}</p><div className="presentation-calcs">{slide === 0 && <><span>7 junctions</span><span>11 roads</span><span>3 graph algorithms</span></>}{slide === 1 && <><span>Undirected edges</span><span>Weight · minutes</span><span>All roads open</span></>}{slide === 2 && <><span>A → C → B → D → E → F → G</span><span>17 min</span></>}{(slide === 3 || slide === 4) && <><span>6 selected edges</span><span>MST total · 17</span></>}{slide === 5 && <><span>Close B–D</span><span>Route becomes 19 min</span></>}{slide === 6 && <><span>Height · 3</span><span>Root · Ibbaluru</span></>}{slide === 7 && <><span>Route planning</span><span>Network design</span></>}</div><div className="presentation-controls"><button className="button button-subtle" disabled={slide === 0} onClick={() => setSlide((value) => Math.max(0, value - 1))}><ChevronLeft size={16} /> Previous</button><button className="button button-primary" onClick={() => slide === slides.length - 1 ? setPresentation(false) : setSlide((value) => Math.min(slides.length - 1, value + 1))}>{slide === slides.length - 1 ? 'Finish' : 'Next'} <ChevronRight size={16} /></button><button className="icon-button presentation-play" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause presentation' : 'Play presentation'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button></div></div><div className="presentation-map">{map({ roadsOverride: slide === 5 ? initialRoads.map((road) => road.id === 'BD' ? { ...road, open: false } : road) : initialRoads, route: slide === 2 ? presentationRoute.path : slide === 5 ? dijkstra(initialRoads.map((road) => road.id === 'BD' ? { ...road, open: false } : road), 'A', 'G').path : [], tree: slide === 3 || slide === 4 || slide === 6 ? kruskal(initialRoads).edges : [], root: slide === 6 ? 'D' : undefined, levels: slide === 6 ? rootTree(kruskal(initialRoads).edges, 'D').levels : undefined })}<div className="presentation-map-label"><span className="live-badge"><i /> SIMULATION NETWORK</span><b>{slides[slide].kicker}</b></div></div></div><div className="presentation-bottom"><span>SMART CITY TRAFFIC NETWORK OPTIMIZATION USING TREES AND ALGORITHMS</span><span>Use arrow controls to navigate the demonstration</span></div></div>}
  </div>;
}
