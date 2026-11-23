"""Optional traffic provider adapters. Credentials are read only from backend settings."""
import requests
from django.conf import settings

def provider_status():
    return {
        'selectedProvider': settings.TRAFFIC_PROVIDER,
        'googleRoutes': {'configured': bool(settings.GOOGLE_ROUTES_API_KEY), 'status': 'configured' if settings.GOOGLE_ROUTES_API_KEY else 'not_configured'},
        'tomtomTraffic': {'configured': bool(settings.TOMTOM_API_KEY), 'status': 'configured' if settings.TOMTOM_API_KEY else 'not_configured'},
        'simulation': {'available': True, 'status': 'active' if settings.TRAFFIC_PROVIDER == 'simulation' else 'fallback'},
    }

def google_traffic_route(origin, destination, travel_mode='DRIVE'):
    if not settings.GOOGLE_ROUTES_API_KEY:
        return None
    response = requests.post('https://routes.googleapis.com/directions/v2:computeRoutes', json={
        'origin': {'location': {'latLng': {'latitude': origin['lat'], 'longitude': origin['lon']}}},
        'destination': {'location': {'latLng': {'latitude': destination['lat'], 'longitude': destination['lon']}}},
        'travelMode': travel_mode,
        'routingPreference': 'TRAFFIC_AWARE_OPTIMAL',
    }, headers={'X-Goog-Api-Key': settings.GOOGLE_ROUTES_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'}, timeout=12)
    response.raise_for_status()
    route = (response.json().get('routes') or [None])[0]
    if not route:
        return None
    return {'provider': 'google_routes', 'duration': route.get('duration'), 'distanceM': route.get('distanceMeters'),
        'encodedPolyline': route.get('polyline', {}).get('encodedPolyline')}

def tomtom_flow(point):
    if not settings.TOMTOM_API_KEY:
        return None
    response = requests.get(f"https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json", params={
        'point': f"{point['lat']},{point['lon']}", 'unit': 'KMPH', 'key': settings.TOMTOM_API_KEY,
    }, timeout=10)
    response.raise_for_status()
    segment = response.json().get('flowSegmentData') or {}
    return {'provider': 'tomtom', 'speedKph': segment.get('currentSpeed'), 'freeFlowSpeedKph': segment.get('freeFlowSpeed'),
        'confidence': segment.get('confidence'), 'roadClosure': segment.get('roadClosure'), 'observedAt': segment.get('@version')}
