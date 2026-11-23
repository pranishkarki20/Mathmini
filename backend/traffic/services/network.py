"""OpenStreetMap network loader plus a clearly identified corridor-model fallback."""
import json
import math
import time
from pathlib import Path
from threading import Lock

import requests
from django.conf import settings

CORRIDOR = {
    'A': {'name': 'Silk Board', 'lat': 12.9177, 'lon': 77.6233},
    'B': {'name': 'Agara', 'lat': 12.9209, 'lon': 77.6505},
    'C': {'name': 'HSR Layout', 'lat': 12.9121, 'lon': 77.6446},
    'D': {'name': 'Ibbaluru', 'lat': 12.9252, 'lon': 77.6700},
    'E': {'name': 'Bellandur', 'lat': 12.9304, 'lon': 77.6781},
    'F': {'name': 'Kadubeesanahalli', 'lat': 12.9377, 'lon': 77.6974},
    'G': {'name': 'Marathahalli', 'lat': 12.9555, 'lon': 77.6980},
}
# The fallback is a small didactic corridor model, never represented as OSM road geometry.
MODEL_LINKS = [
    ('A', 'B', 4), ('A', 'C', 2), ('B', 'C', 1), ('B', 'D', 5), ('C', 'D', 8),
    ('C', 'E', 10), ('D', 'E', 2), ('D', 'F', 6), ('E', 'F', 3), ('E', 'G', 8), ('F', 'G', 4),
]
_lock = Lock()
_last_attempt = 0.0

def haversine(a, b):
    lat1, lon1 = math.radians(a[1]), math.radians(a[0])
    lat2, lon2 = math.radians(b[1]), math.radians(b[0])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))

def _cache_path():
    return Path(settings.BASE_DIR) / 'data' / 'bengaluru_corridor_osm.json'

def _speed_for_class(highway):
    return {'motorway': 70, 'trunk': 55, 'primary': 40, 'secondary': 32, 'tertiary': 25, 'unclassified': 20, 'residential': 18}.get(highway, 20)

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
        one_way_tag = tags.get('oneway', '')
        is_oneway = one_way_tag in ('yes', '1', 'true', '-1') or tags.get('junction') == 'roundabout'
        reverse_oneway = one_way_tag == '-1'
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
            nodes[first] = p1; nodes[second] = p2
            edge = {'id': f'{road_id}:{first}:{second}', 'roadId': road_id, 'name': name, 'highway': highway,
                'a': first, 'b': second, 'coordinates': [p1, p2], 'distanceM': round(segment_length, 1),
                'baseSpeedKph': speed, 'oneway': is_oneway}
            edges.append(edge)
    return {'features': {'type': 'FeatureCollection', 'features': features}, 'edges': edges, 'nodes': nodes,
        'junctions': CORRIDOR, 'source': 'openstreetmap', 'sourceLabel': 'OpenStreetMap road geometry', 'isLiveTraffic': False}

def fetch_osm_network(timeout=12):
    query = ('[out:json][timeout:20];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"]'
             '(12.900,77.600,12.970,77.720);out body geom;')
    response = requests.post(settings.OVERPASS_URL, data={'data': query}, timeout=timeout,
        headers={'User-Agent': 'SmartFlow-Bengaluru/1.0 (academic traffic simulation)', 'Accept': 'application/json'})
    response.raise_for_status()
    return convert_overpass(response.json())

def fallback_network():
    features, edges = [], []
    nodes = {key: [value['lon'], value['lat']] for key, value in CORRIDOR.items()}
    for a, b, assumed_minutes in MODEL_LINKS:
        pa, pb = nodes[a], nodes[b]
        length = haversine(pa, pb)
        road_id = f'model-{a}{b}'
        edge = {'id': road_id, 'roadId': road_id, 'name': f'Corridor model link {a}–{b}', 'highway': 'model',
            'a': a, 'b': b, 'coordinates': [pa, pb], 'distanceM': round(length), 'baseSpeedKph': round(length / (assumed_minutes / 60)),
            'assumedMinutes': assumed_minutes, 'oneway': False}
        edges.append(edge)
        features.append({'type': 'Feature', 'id': road_id, 'geometry': {'type': 'LineString', 'coordinates': [pa, pb]},
            'properties': {'roadId': road_id, 'name': edge['name'], 'highway': 'model', 'distanceM': edge['distanceM'],
                'baseSpeedKph': edge['baseSpeedKph'], 'assumedMinutes': assumed_minutes, 'source': 'corridor simulation',
                'condition': 'simulated', 'oneway': False}})
    return {'features': {'type': 'FeatureCollection', 'features': features}, 'edges': edges, 'nodes': nodes,
        'junctions': CORRIDOR, 'source': 'simulation_fallback', 'sourceLabel': 'Corridor model · OSM extract unavailable', 'isLiveTraffic': False}

def get_network(force_refresh=False):
    """Use a local OSM extract when present; refresh only on request/first configured fetch."""
    global _last_attempt
    cache = _cache_path()
    if cache.exists() and not force_refresh:
        try:
            return json.loads(cache.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            pass
    if force_refresh or (settings.OSM_AUTO_FETCH and time.monotonic() - _last_attempt > 300):
        with _lock:
            if not force_refresh and time.monotonic() - _last_attempt <= 300:
                return fallback_network()
            _last_attempt = time.monotonic()
            try:
                network = fetch_osm_network()
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(network), encoding='utf-8')
                return network
            except (requests.RequestException, ValueError, KeyError):
                if cache.exists():
                    try:
                        cached = json.loads(cache.read_text(encoding='utf-8'))
                        cached['refreshError'] = 'OpenStreetMap data service is unavailable; showing the last saved road extract.'
                        return cached
                    except (OSError, json.JSONDecodeError):
                        pass
    return fallback_network()
