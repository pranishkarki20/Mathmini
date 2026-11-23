"""Optional traffic provider adapters. Credentials are read only from backend settings."""
import requests
from django.conf import settings

def provider_status():
    return {
        'placeSearch': {'service': 'Nominatim', 'status': 'available', 'policy': 'public service · rate-limited and cached'},
        'routing': {'service': 'OSRM', 'status': 'configured' if settings.OSRM_BASE_URL else 'not_configured', 'endpoint': settings.OSRM_BASE_URL},
        'traffic': {'status': 'unavailable', 'message': 'No live traffic feed is configured.'},
    }

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
