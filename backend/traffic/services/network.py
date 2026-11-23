"""Convert retrieved OpenStreetMap road ways into graph-ready structures."""
import math


def haversine(a, b):
    lat1, lon1 = math.radians(a[1]), math.radians(a[0])
    lat2, lon2 = math.radians(b[1]), math.radians(b[0])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _speed_for_class(highway):
    return {'motorway': 70, 'trunk': 55, 'primary': 40, 'secondary': 32, 'tertiary': 25,
            'unclassified': 20, 'residential': 18}.get(highway, 20)


def convert_overpass(payload):
    features, edges, nodes = [], [], {}
    for way in payload.get('elements', []):
        geometry = way.get('geometry') or []
        way_nodes = way.get('nodes') or []
        if len(geometry) < 2 or len(way_nodes) != len(geometry):
            continue
        tags = way.get('tags', {})
        highway = tags.get('highway', 'unclassified')
        road_id = f"osm-way-{way['id']}"
        name = tags.get('name') or tags.get('ref') or f"{highway.title()} road"
        coords = [[point['lon'], point['lat']] for point in geometry]
        length = sum(haversine(coords[index], coords[index + 1]) for index in range(len(coords) - 1))
        speed = _speed_for_class(highway)
        oneway_tag = tags.get('oneway', '')
        is_oneway = oneway_tag in ('yes', '1', 'true', '-1') or tags.get('junction') == 'roundabout'
        reverse_oneway = oneway_tag == '-1'
        features.append({'type': 'Feature', 'id': road_id, 'geometry': {'type': 'LineString', 'coordinates': coords},
                         'properties': {'roadId': road_id, 'name': name, 'highway': highway, 'distanceM': round(length, 1),
                                        'baseSpeedKph': speed, 'source': 'OpenStreetMap', 'condition': 'unobserved', 'oneway': is_oneway}})
        for index in range(len(way_nodes) - 1):
            first, second = str(way_nodes[index]), str(way_nodes[index + 1])
            p1, p2 = coords[index], coords[index + 1]
            if reverse_oneway:
                first, second, p1, p2 = second, first, p2, p1
            segment_length = haversine(p1, p2)
            if segment_length < 1:
                continue
            nodes[first] = p1
            nodes[second] = p2
            edges.append({'id': f'{road_id}:{first}:{second}', 'roadId': road_id, 'name': name, 'highway': highway,
                          'a': first, 'b': second, 'coordinates': [p1, p2], 'distanceM': round(segment_length, 1),
                          'baseSpeedKph': speed, 'oneway': is_oneway})
    degree = {}
    for edge in edges:
        degree[edge['a']] = degree.get(edge['a'], 0) + 1
        degree[edge['b']] = degree.get(edge['b'], 0) + 1
    junctions = {node: {'name': f'OSM intersection {node}', 'lat': coords[1], 'lon': coords[0]}
                 for node, coords in nodes.items() if degree.get(node, 0) >= 3}
    return {'features': {'type': 'FeatureCollection', 'features': features}, 'edges': edges, 'nodes': nodes,
            'junctions': junctions, 'source': 'openstreetmap', 'sourceLabel': 'OpenStreetMap road geometry', 'isLiveTraffic': False}


def fallback_network():
    """Return an empty state instead of silently substituting a fictional corridor."""
    return {'features': {'type': 'FeatureCollection', 'features': []}, 'edges': [], 'nodes': {}, 'junctions': {},
            'source': 'unavailable', 'sourceLabel': 'No road extract loaded. Search and load an OpenStreetMap area.', 'isLiveTraffic': False}


def get_network(force_refresh=False):
    """There is no default geography; road areas are requested by explicit bounds."""
    return fallback_network()
