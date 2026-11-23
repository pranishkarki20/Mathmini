"""Cached, bounded Overpass road extracts and graph analyses for a chosen map area."""
import hashlib
import json
from pathlib import Path

import networkx as nx
import requests
from django.conf import settings

from .network import convert_overpass


class AreaNetworkError(Exception):
    pass


def _validate_bbox(bbox):
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        raise AreaNetworkError('Map bounds must contain south, west, north and east coordinates.')
    try:
        south, west, north, east = [float(value) for value in bbox]
    except (TypeError, ValueError) as error:
        raise AreaNetworkError('Map bounds must be numeric coordinates.') from error
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
        raise AreaNetworkError('Map bounds are invalid. Pan and zoom to a smaller area, then retry.')
    if north - south > 0.12 or east - west > 0.12:
        raise AreaNetworkError('Select a smaller area (maximum 0.12° in each direction) to keep OpenStreetMap extracts manageable.')
    return [round(south, 5), round(west, 5), round(north, 5), round(east, 5)]


def _cache_file(bbox):
    key = hashlib.sha256(','.join(map(str, bbox)).encode()).hexdigest()[:20]
    folder = Path(settings.BASE_DIR) / 'data' / 'areas'
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f'{key}.json'


def _summarize(data, bbox):
    graph = nx.Graph()
    for edge in data['edges']:
        graph.add_edge(edge['a'], edge['b'], roadId=edge['roadId'])
    degrees = dict(graph.degree())
    node_lookup = data.get('nodes', {})
    junctions = []
    for node, degree in degrees.items():
        if degree >= 3 and node in node_lookup:
            lon, lat = node_lookup[node]
            junctions.append({'id': str(node), 'name': f'OSM junction {node}', 'latitude': lat, 'longitude': lon, 'roadCount': degree})
    try:
        critical = list(nx.articulation_points(graph))
    except nx.NetworkXError:
        critical = []
    data['junctions'] = junctions
    data['metrics'] = {
        'roadSegments': len(data['edges']),
        'mappedRoads': len(data['features']['features']),
        'junctions': len(junctions),
        'totalRoadDistanceMeters': round(sum(edge['distanceM'] for edge in data['edges'])),
        'connectedAreas': nx.number_connected_components(graph) if graph else 0,
        'criticalJunctions': len(critical),
        'criticalJunctionIds': [str(node) for node in critical],
    }
    data['bbox'] = bbox
    data['source'] = 'openstreetmap'
    data['sourceLabel'] = 'OpenStreetMap via Overpass · cached extract'
    return data


def get_area_network(raw_bbox, refresh=False):
    bbox = _validate_bbox(raw_bbox)
    path = _cache_file(bbox)
    if path.exists() and not refresh:
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            pass
    south, west, north, east = bbox
    query = (f'[out:json][timeout:25];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)$"]'
             f'({south},{west},{north},{east});out body geom;')
    try:
        response = requests.post(settings.OVERPASS_URL, data={'data': query}, timeout=35, headers={
            'User-Agent': 'SmartFlowRoadNetworkPlatform/1.0', 'Accept': 'application/json',
        })
        response.raise_for_status()
        data = _summarize(convert_overpass(response.json()), bbox)
    except (requests.RequestException, ValueError, KeyError) as error:
        if path.exists():
            try:
                cached = json.loads(path.read_text(encoding='utf-8'))
                cached['refreshError'] = f'Overpass is unavailable; showing the cached extract. {error}'
                return cached
            except (OSError, json.JSONDecodeError):
                pass
        raise AreaNetworkError(f'OpenStreetMap road extract failed: {error}') from error
    path.write_text(json.dumps(data), encoding='utf-8')
    return data


def route_in_area(raw_bbox, start, end, closed_road_ids=None):
    data = get_area_network(raw_bbox)
    graph = nx.MultiDiGraph()
    closed = set(closed_road_ids or [])
    graph.add_nodes_from(node for edge in data['edges'] for node in (edge['a'], edge['b']))
    edge_lookup = {edge['id']: edge for edge in data['edges'] if edge['roadId'] not in closed}
    for edge in edge_lookup.values():
        graph.add_edge(edge['a'], edge['b'], key=edge['id'], weight=edge['distanceM'], roadId=edge['roadId'], roadName=edge['name'], coordinates=edge['coordinates'])
        if not edge['oneway']:
            graph.add_edge(edge['b'], edge['a'], key=f"{edge['id']}:reverse", weight=edge['distanceM'], roadId=edge['roadId'], roadName=edge['name'], coordinates=list(reversed(edge['coordinates'])))
    start, end = str(start), str(end)
    if start not in graph or end not in graph:
        raise AreaNetworkError('Choose junctions from the currently loaded road network area.')
    try:
        nodes = nx.shortest_path(graph, start, end, weight='weight')
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return {'reachable': False, 'segments': [], 'distanceMeters': 0, 'closedRoadIds': sorted(closed), 'message': 'These junctions are disconnected by the selected road closures.'}
    segments = []
    for a, b in zip(nodes, nodes[1:]):
        options = graph[a][b].values()
        selected = min(options, key=lambda item: item['weight'])
        segments.append({'roadId': selected['roadId'], 'name': selected['roadName'], 'coordinates': selected['coordinates'], 'distanceMeters': selected['weight']})
    return {'reachable': True, 'segments': segments, 'distanceMeters': round(sum(item['distanceMeters'] for item in segments)), 'closedRoadIds': sorted(closed), 'junctionPath': nodes}


def plan_infrastructure(raw_bbox, junction_ids, estimated_cost_per_km):
    data = get_area_network(raw_bbox)
    road_graph = nx.Graph()
    road_lookup = {}
    for edge in data['edges']:
        road_graph.add_edge(edge['a'], edge['b'], weight=edge['distanceM'])
        road_lookup[frozenset((edge['a'], edge['b']))] = edge
    selected = list(dict.fromkeys(str(value) for value in junction_ids))
    if len(selected) < 2 or any(node not in road_graph for node in selected):
        raise AreaNetworkError('Select at least two junctions from the loaded road network.')
    distances = {}
    paths = {}
    for source in selected:
        lengths, source_paths = nx.single_source_dijkstra(road_graph, source, weight='weight')
        distances[source] = lengths
        paths[source] = source_paths
    candidates = nx.Graph()
    candidates.add_nodes_from(selected)
    for index, source in enumerate(selected):
        for destination in selected[index + 1:]:
            if destination in distances[source]:
                candidates.add_edge(source, destination, weight=distances[source][destination])
    tree = nx.minimum_spanning_tree(candidates, weight='weight')
    connections = []
    for source, destination, values in tree.edges(data=True):
        road_path = paths[source][destination]
        segments = []
        for a, b in zip(road_path, road_path[1:]):
            edge = road_lookup[frozenset((a, b))]
            coordinates = edge['coordinates'] if str(edge['a']) == str(a) else list(reversed(edge['coordinates']))
            segments.append({'roadId': edge['roadId'], 'name': edge['name'], 'coordinates': coordinates, 'distanceMeters': edge['distanceM']})
        distance = round(values['weight'])
        connections.append({'fromJunction': source, 'toJunction': destination, 'distanceMeters': distance,
            'estimatedInstallationCost': round(distance / 1000 * float(estimated_cost_per_km)), 'segments': segments})
    return {'connected': len(tree.edges) == len(selected) - 1, 'selectedJunctions': selected, 'connections': connections,
        'totalDistanceMeters': sum(item['distanceMeters'] for item in connections),
        'estimatedInstallationCost': sum(item['estimatedInstallationCost'] for item in connections),
        'costBasis': 'User-entered estimate per road kilometre; replace with site survey and supplier quotes.'}
