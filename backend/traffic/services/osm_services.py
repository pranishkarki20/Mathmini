"""Rate-limited public Nominatim search and OSRM route adapters."""
import hashlib
import time
from threading import Lock

import requests
from django.conf import settings
from django.core.cache import cache

NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
_nominatim_lock = Lock()
_last_nominatim_request = 0.0


class GeoServiceError(Exception):
    pass


def search_nominatim(query):
    global _last_nominatim_request
    normalized = ' '.join(query.split())[:200]
    key = 'nominatim-search-india:' + hashlib.sha256(normalized.casefold().encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached
    with _nominatim_lock:
        wait = 1.05 - (time.monotonic() - _last_nominatim_request)
        if wait > 0:
            time.sleep(wait)
        _last_nominatim_request = time.monotonic()
        try:
            response = requests.get(NOMINATIM_URL, params={
                'q': normalized, 'format': 'jsonv2', 'limit': 6, 'addressdetails': 1,
                'countrycodes': 'in',
            }, headers={
                'User-Agent': settings.NOMINATIM_USER_AGENT,
                'Accept': 'application/json',
            }, timeout=12)
            response.raise_for_status()
            data = response.json()
        except (requests.RequestException, ValueError) as error:
            raise GeoServiceError(f'OpenStreetMap place search is unavailable: {error}') from error
    results = [{
        'placeId': str(item.get('place_id', '')),
        'name': item.get('name') or item.get('display_name', '').split(',')[0],
        'displayName': item.get('display_name', ''),
        'latitude': float(item['lat']),
        'longitude': float(item['lon']),
        'osmType': item.get('osm_type'),
        'osmId': item.get('osm_id'),
        'category': item.get('category'),
        'type': item.get('type'),
    } for item in data if item.get('lat') and item.get('lon')]
    cache.set(key, results, timeout=60 * 60 * 24)
    return results


def get_osrm_route(coordinates, alternatives=True):
    if not settings.OSRM_BASE_URL:
        raise GeoServiceError('OSRM_BASE_URL is not configured.')
    encoded = ';'.join(f"{point['longitude']},{point['latitude']}" for point in coordinates)
    url = f"{settings.OSRM_BASE_URL.rstrip('/')}/route/v1/driving/{encoded}"
    try:
        response = requests.get(url, params={
            'alternatives': 'true' if alternatives and len(coordinates) == 2 else 'false',
            'steps': 'true', 'overview': 'full', 'geometries': 'geojson',
        }, headers={'User-Agent': settings.NOMINATIM_USER_AGENT}, timeout=20)
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        raise GeoServiceError(f'OSRM routing is unavailable: {error}') from error
    if payload.get('code') != 'Ok' or not payload.get('routes'):
        raise GeoServiceError(payload.get('message') or 'OSRM could not find a route for these locations.')
    routes = []
    for index, route in enumerate(payload['routes']):
        legs = route.get('legs', [])
        routes.append({
            'id': index,
            'distanceMeters': route.get('distance', 0),
            'durationSeconds': route.get('duration', 0),
            'geometry': route.get('geometry', {'type': 'LineString', 'coordinates': []}),
            'legs': [{
                'summary': leg.get('summary', ''),
                'distanceMeters': leg.get('distance', 0),
                'durationSeconds': leg.get('duration', 0),
                'steps': [{
                    'name': step.get('name', ''),
                    'distanceMeters': step.get('distance', 0),
                    'durationSeconds': step.get('duration', 0),
                    'type': (step.get('maneuver') or {}).get('type', ''),
                    'modifier': (step.get('maneuver') or {}).get('modifier', ''),
                } for step in leg.get('steps', [])],
            } for leg in legs],
        })
    return {'routes': routes, 'source': 'OSRM · OpenStreetMap road data', 'retrievedAt': time.time()}
