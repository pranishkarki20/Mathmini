"""Dijkstra/A* and Prim/Kruskal implementations over geospatial or model segments."""
import heapq
import math

import networkx as nx

from .network import haversine

def _edge_weight(edge, factors):
    factor = max(0.25, min(5.0, float(factors.get(edge['roadId'], 1.0))))
    if 'assumedMinutes' in edge:
        return max(0.1, float(edge['assumedMinutes']) * factor)
    speed = max(4.0, float(edge.get('baseSpeedKph', 20)) / factor)
    return max(0.001, float(edge['distanceM']) / 1000 / speed * 60)

def _graph(network, closed_roads, factors, mode='driving', preference='fastest'):
    edges = []
    for source in network['edges']:
        if source['roadId'] in closed_roads:
            continue
        edge = dict(source)
        if mode == 'walking':
            edge['baseSpeedKph'] = 5
            edge.pop('assumedMinutes', None)
        elif mode == 'cycling':
            edge['baseSpeedKph'] = 15
            edge.pop('assumedMinutes', None)
        edge['weight'] = _edge_weight(edge, factors)
        edge['cost'] = float(edge['distanceM']) if preference == 'shortest' else edge['weight']
        edges.append(edge)
    # NetworkX provides network connectivity/edge inspection; paths below are custom algorithms.
    graph = nx.MultiDiGraph()
    for edge in edges:
        graph.add_edge(edge['a'], edge['b'], key=edge['id'], weight=edge['cost'], road_id=edge['roadId'])
        if not edge.get('oneway'):
            graph.add_edge(edge['b'], edge['a'], key=edge['id'] + ':reverse', weight=edge['cost'], road_id=edge['roadId'])
    return graph, edges

def _nearest_node(network, location):
    candidates = network['nodes']
    target = [location['lon'], location['lat']]
    if not candidates:
        return location['code'], target
    if location['code'] in candidates:
        node = location['code']
    else:
        node = min(candidates, key=lambda item: haversine(candidates[item], target))
    return node, candidates[node]

def _heuristic(network, node, target_node, min_minutes_per_meter):
    coords = network['nodes']
    if node not in coords or target_node not in coords:
        return 0
    return haversine(coords[node], coords[target_node]) * min_minutes_per_meter

def find_route(network, start_code, end_code, algorithm='dijkstra', closed_roads=None, factors=None, mode='driving', preference='fastest'):
    closed_roads = set(closed_roads or [])
    factors = factors or {}
    if preference not in ('fastest', 'shortest'):
        preference = 'fastest'
    graph, edges = _graph(network, closed_roads, factors, mode, preference)
    coords = network.get('nodes', {})
    if start_code not in coords or end_code not in coords:
        return {'path': [], 'segments': [], 'distanceM': 0, 'travelTimeMinutes': None, 'normalTimeMinutes': None, 'reachable': False, 'algorithm': algorithm, 'start': start_code, 'destination': end_code, 'message': 'Choose endpoints from the loaded road graph.'}
    start_location = {'code': start_code, 'lon': coords[start_code][0], 'lat': coords[start_code][1]}
    end_location = {'code': end_code, 'lon': coords[end_code][0], 'lat': coords[end_code][1]}
    start, start_coords = _nearest_node(network, {'code': start_code, **start_location})
    end, end_coords = _nearest_node(network, {'code': end_code, **end_location})
    if start == end:
        return {'path': [start], 'segments': [], 'distanceM': 0, 'travelTimeMinutes': 0, 'normalTimeMinutes': 0, 'reachable': True, 'algorithm': algorithm, 'start': start_code, 'destination': end_code}
    min_ratio = min((edge['cost'] / max(edge['distanceM'], 1) for edge in edges), default=0)
    queue = [(0, 0.0, start)]
    distance = {start: 0.0}; previous = {}; finalized = set()
    while queue:
        _, cost_so_far, node = heapq.heappop(queue)
        if node in finalized or cost_so_far > distance.get(node, math.inf):
            continue
        finalized.add(node)
        adjacent = sorted(graph.out_edges(node, keys=True, data=True), key=lambda item: str(item[2]))
        for _, neighbor, key, data in adjacent:
            candidate = cost_so_far + data['weight']
            if candidate < distance.get(neighbor, math.inf):
                distance[neighbor] = candidate
                previous[neighbor] = (node, key, data['road_id'])
                heuristic = 0 if algorithm == 'dijkstra' else _heuristic(network, neighbor, end, min_ratio)
                heapq.heappush(queue, (candidate + heuristic, candidate, neighbor))
        if node == end:
            break
    if end not in distance:
        return {'path': [], 'segments': [], 'distanceM': 0, 'travelTimeMinutes': None, 'normalTimeMinutes': None, 'reachable': False, 'algorithm': algorithm, 'start': start_code, 'destination': end_code}
    path = [end]; segments = []; cursor = end
    while cursor != start:
        parent, key, road_id = previous[cursor]
        base_id = key.removesuffix(':reverse')
        segment = next(item for item in edges if item['id'] == base_id)
        coords = segment['coordinates'] if segment['a'] == parent else list(reversed(segment['coordinates']))
        segments.append({'id': base_id, 'roadId': road_id, 'name': segment['name'], 'distanceM': segment['distanceM'], 'travelTimeMinutes': segment['weight'], 'coordinates': coords})
        cursor = parent; path.append(cursor)
    path.reverse(); segments.reverse()
    normal = 0.0
    for item in segments:
        source = next(edge for edge in network['edges'] if edge['id'] == item['id'])
        normal_edge = dict(source)
        if mode == 'walking': normal_edge.update({'baseSpeedKph': 5}); normal_edge.pop('assumedMinutes', None)
        elif mode == 'cycling': normal_edge.update({'baseSpeedKph': 15}); normal_edge.pop('assumedMinutes', None)
        normal += _edge_weight(normal_edge, {})
    actual_travel_time = sum(item['travelTimeMinutes'] for item in segments)
    return {'path': path, 'segments': segments, 'distanceM': round(sum(item['distanceM'] for item in segments)),
        'travelTimeMinutes': round(actual_travel_time, 1), 'normalTimeMinutes': round(normal, 1),
        'timeSavedMinutes': round(max(0, normal - actual_travel_time), 1), 'delayMinutes': round(max(0, actual_travel_time - normal), 1), 'optimizationCost': round(distance[end], 1), 'preference': preference,
        'reachable': True, 'algorithm': algorithm, 'start': start_code, 'destination': end_code,
        'snappedStart': {'lat': start_coords[1], 'lon': start_coords[0]}, 'snappedDestination': {'lat': end_coords[1], 'lon': end_coords[0]}}

def sensor_mst(sites, connections, algorithm='kruskal', redundant=False):
    """Run custom Prim/Kruskal; also use NetworkX to report network connectivity."""
    candidates = [item for item in connections if item['connected']]
    candidates.sort(key=lambda item: (item['installCost'], item['id']))
    site_codes = sorted(site['code'] for site in sites)
    chosen = []
    if algorithm == 'prim' and site_codes:
        reached = {site_codes[0]}
        while len(reached) < len(site_codes):
            edge = next((item for item in sorted(candidates, key=lambda e: (e['installCost'], e['id'])) if (item['a'] in reached) != (item['b'] in reached)), None)
            if edge is None: break
            chosen.append(edge); reached.add(edge['b'] if edge['a'] in reached else edge['a'])
    else:
        parent = {code: code for code in site_codes}
        def find(code):
            while parent[code] != code:
                parent[code] = parent[parent[code]]; code = parent[code]
            return code
        for edge in candidates:
            ra, rb = find(edge['a']), find(edge['b'])
            accepted = ra != rb
            if accepted:
                parent[ra] = rb; chosen.append(edge)
            if len(chosen) == max(len(site_codes) - 1, 0): break
    nx_graph = nx.Graph()
    nx_graph.add_nodes_from(site_codes)
    nx_graph.add_weighted_edges_from((item['a'], item['b'], item['installCost']) for item in candidates)
    components = nx.number_connected_components(nx_graph) if site_codes else 0
    total = sum(item['installCost'] for item in chosen)
    all_cost = sum(item['installCost'] for item in candidates)
    backup = []
    if redundant:
        chosen_ids = {item['id'] for item in chosen}
        backup = [item for item in candidates if item['id'] not in chosen_ids][:max(1, len(site_codes) // 3)]
    return {'algorithm': algorithm, 'edges': chosen, 'totalInstallCost': round(total, 2),
        'maintenanceCostYear': round(sum(item.get('maintenanceCostYear', 0) for item in chosen), 2),
        'siteCount': len(site_codes), 'connectionCount': len(chosen), 'connected': components <= 1,
        'componentCount': components, 'alternativeConnectionCost': round(all_cost, 2),
        'savings': round(max(0, all_cost - total), 2), 'redundantConnections': backup}
