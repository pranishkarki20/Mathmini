import { Activity, Download, Info, MapPinned, Network, Route, ShieldAlert } from 'lucide-react';
import type { AreaNetworkData, NetworkData } from '../api';

function analyzeNetwork(network: Pick<NetworkData, 'edges'>) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of network.edges) {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, new Set());
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, new Set());
    adjacency.get(edge.a)!.add(edge.b); adjacency.get(edge.b)!.add(edge.a);
  }
  let components = 0;
  const visited = new Set<string>();
  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    components += 1; const stack = [node]; visited.add(node);
    while (stack.length) for (const next of adjacency.get(stack.pop()!) ?? []) if (!visited.has(next)) { visited.add(next); stack.push(next); }
  }
  const degree = [...adjacency.entries()].map(([id, links]) => ({ id, degree: links.size })).sort((a, b) => b.degree - a.degree);
  const kinds = new Map<string, number>();
  for (const edge of network.edges) kinds.set(edge.highway || 'unclassified', (kinds.get(edge.highway || 'unclassified') ?? 0) + 1);
  return { nodes: adjacency.size, components, degree, kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]), distance: network.edges.reduce((sum, edge) => sum + edge.distanceM, 0) };
}

export default function AnalyticsDashboard({ network, area }: { network: NetworkData; area?: AreaNetworkData | null }) {
  const graph = area ?? network;
  const updatedAt = area?.retrievedAt ?? network.updatedAt;
  const available = graph.source === 'openstreetmap' && graph.edges.length > 0;
  const report = available ? analyzeNetwork(graph) : null;
  const exportCsv = () => {
    if (!report) return;
    const rows = [['SmartFlow network analytics'], ['Selected area', area?.bbox.join(', ') ?? 'Current extract'], ['Source', graph.sourceLabel], ['Updated', updatedAt], ['Road segments', graph.edges.length], ['Graph nodes', report.nodes], ['Mapped road distance (km)', (report.distance / 1000).toFixed(2)], ['Connected components', report.components], [], ['Junction', 'Mapped road connections'], ...report.degree.slice(0, 50).map((node) => [node.id, node.degree]), [], ['Road classification', 'Segments'], ...report.kinds];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'smartflow-network-analytics.csv'; link.click(); URL.revokeObjectURL(link.href);
  };
  return <div className="analytics-page"><div className="module-title-row"><div><span className="eyebrow">NETWORK INTELLIGENCE</span><h2>Road network analytics</h2><p>Graph statistics are derived from the currently available OpenStreetMap road extract.</p></div>{available && <div className="network-report-actions"><button className="button" onClick={exportCsv}><Download size={14}/> Export CSV</button><button className="button" onClick={() => window.print()}>Print / save PDF</button></div>}</div>
    {!report ? <section className="surface analytics-empty"><MapPinned size={22}/><h3>No real road extract is loaded</h3><p>Load an area in Road network analysis to review its graph statistics. Traffic volumes and live congestion are not available in this project.</p></section> : <><div className="analytics-kpi-grid"><Kpi icon={Network} label="Road segments" value={graph.edges.length.toLocaleString('en-IN')} note="From OSM road graph"/><Kpi icon={MapPinned} label="Junction graph nodes" value={report.nodes.toLocaleString('en-IN')} note="Road connection nodes"/><Kpi icon={Route} label="Mapped road distance" value={`${(report.distance / 1000).toFixed(2)} km`} note="Sum of extracted road segments"/><Kpi icon={ShieldAlert} label="Connected components" value={String(report.components)} note={report.components === 1 ? 'One connected graph' : 'Some road areas are disconnected'}/></div>
      <div className="analytics-chart-grid"><section className="surface chart-surface"><div className="section-heading"><div><h3>Highest degree junctions</h3><p>Ranked by number of directly connected road graph nodes.</p></div><Activity size={16}/></div><div className="analytics-rank-list">{report.degree.slice(0, 12).map((item, index) => <div key={item.id}><span>{index + 1}</span><b>{item.id}</b><i style={{ width: `${Math.max(4, item.degree / Math.max(report.degree[0]?.degree ?? 1, 1) * 100)}%` }}/><small>{item.degree} links</small></div>)}</div></section>
      <section className="surface chart-surface"><div className="section-heading"><div><h3>Road classifications</h3><p>Highway tags provided by OpenStreetMap.</p></div><Info size={16}/></div><div className="analytics-rank-list">{report.kinds.map(([kind, count]) => <div key={kind}><span>•</span><b>{kind.replaceAll('_', ' ')}</b><i style={{ width: `${Math.max(4, count / Math.max(report.kinds[0]?.[1] ?? 1, 1) * 100)}%` }}/><small>{count} segments</small></div>)}</div></section></div>
      <div className="analytics-provenance"><Info size={14}/>{graph.sourceLabel} · {updatedAt ? new Date(updatedAt).toLocaleString() : 'Extraction timestamp unavailable'}. Geometry and road tags are from OSM; these statistics do not include vehicle counts or measured travel conditions.</div></>}
  </div>;
}

function Kpi({ icon: Icon, label, value, note }: { icon: typeof Network; label: string; value: string; note: string }) {
  return <article className="surface analytics-kpi"><span className="kpi-icon"><Icon size={16}/></span><div><small>{label}</small><b>{value}</b><span>{note}</span></div></article>;
}
