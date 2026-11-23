from datetime import timedelta

import requests
from django.conf import settings
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Incident, RoadSegment, SensorConnection, SensorSite, SignalMeasurement, TrafficObservation
from .permissions import OperatorWritePermission
from .serializers import IncidentSerializer, OptimizeSensorSerializer, SensorConnectionSerializer, SensorSiteSerializer, SignalInputSerializer, TrafficInputSerializer
from .services.algorithms import find_route, sensor_mst
from .services.network import CORRIDOR, get_network
from .services.providers import google_traffic_route, provider_status, tomtom_flow

def _latest_observations():
    result = {}
    for item in TrafficObservation.objects.order_by('road_id', '-observed_at'):
        result.setdefault(item.road_id, item)
    return result

def _traffic_view(network, observations=None, incidents=None):
    observations = observations if observations is not None else _latest_observations()
    incidents = incidents if incidents is not None else list(Incident.objects.filter(status=Incident.Status.ACTIVE))
    blocked = {item.road_id for item in incidents if item.road_id and (item.kind == Incident.Kind.CLOSURE or (item.kind == Incident.Kind.ACCIDENT and item.severity == Incident.Severity.CRITICAL))}
    output = []
    now = timezone.now()
    for feature in network['features']['features']:
        props = feature['properties']; road_id = props['roadId']
        observation = observations.get(road_id)
        is_model = props.get('source') == 'corridor simulation'
        base_speed = float(props.get('baseSpeedKph') or 20)
        simulated_speed = round(base_speed * 0.62, 1)
        speed = observation.speed_kph if observation and observation.speed_kph else simulated_speed
        if observation:
            source = observation.get_source_display()
            simulated = observation.is_simulated
            observed = observation.observed_at
            condition = observation.congestion
        else:
            source = 'Simulation · modeled baseline' if settings.TRAFFIC_PROVIDER == 'simulation' else 'Simulation fallback · provider unavailable'
            simulated = True; observed = now
            condition = 'moderate' if speed < base_speed * 0.75 else 'normal'
        closed = road_id in blocked
        props.update({'speedKph': None if closed else speed, 'estimatedTravelTimeMinutes': round(props['distanceM'] / max(speed, 1) * 0.06, 1),
            'condition': 'closed' if closed else condition, 'closed': closed, 'dataSource': source,
            'isSimulated': simulated, 'lastUpdated': observed.isoformat() if hasattr(observed, 'isoformat') else str(observed)})
        output.append({'roadId': road_id, 'name': props.get('name'), 'speedKph': props['speedKph'], 'condition': props['condition'],
            'distanceM': props['distanceM'], 'estimatedTravelTimeMinutes': props['estimatedTravelTimeMinutes'],
            'source': source, 'isSimulated': simulated, 'lastUpdated': props['lastUpdated'], 'closed': closed})
    return output

def _active_closures():
    items = Incident.objects.filter(status=Incident.Status.ACTIVE)
    return {item.road_id for item in items if item.road_id and (item.kind == Incident.Kind.CLOSURE or (item.kind == Incident.Kind.ACCIDENT and item.severity == Incident.Severity.CRITICAL))}

def _traffic_factors(network, observations=None):
    observations = observations if observations is not None else _latest_observations()
    factors = {}
    for edge in network['edges']:
        observation = observations.get(edge['roadId'])
        if observation and observation.speed_kph:
            factors[edge['roadId']] = max(0.25, edge.get('baseSpeedKph', observation.speed_kph) / observation.speed_kph)
    return factors

@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    network = get_network()
    return Response({'status': 'ok', 'service': 'SmartFlow Bengaluru API', 'dataSource': network['sourceLabel'],
        'isLiveTraffic': False, 'providers': provider_status(), 'database': settings.DATABASES['default']['ENGINE'].rsplit('.', 1)[-1],
        'updatedAt': timezone.now().isoformat()})

@api_view(['GET'])
@permission_classes([AllowAny])
def network_view(request):
    force = request.query_params.get('refresh') == '1'
    network = get_network(force_refresh=force)
    incidents = list(Incident.objects.filter(status=Incident.Status.ACTIVE))
    traffic = _traffic_view(network, incidents=incidents)
    return Response({'source': network['source'], 'sourceLabel': network['sourceLabel'], 'isLiveTraffic': False,
        'attribution': '© OpenStreetMap contributors', 'updatedAt': timezone.now().isoformat(),
        'refreshError': network.get('refreshError'), 'junctions': [{'code': code, **value} for code, value in network['junctions'].items()],
        'geojson': network['features'], 'edges': network['edges'], 'nodes': network.get('nodes', {}), 'traffic': traffic,
        'incidents': IncidentSerializer(incidents, many=True).data})

@api_view(['POST'])
@permission_classes([AllowAny])
def route_view(request):
    start = request.data.get('start', 'A'); end = request.data.get('destination', 'G')
    if start not in CORRIDOR or end not in CORRIDOR:
        return Response({'detail': 'Select valid corridor junction codes A–G.'}, status=status.HTTP_400_BAD_REQUEST)
    if start == end:
        return Response({'detail': 'Choose two different junctions.'}, status=status.HTTP_400_BAD_REQUEST)
    algorithm = request.data.get('algorithm', 'dijkstra')
    if algorithm not in ('dijkstra', 'astar'):
        return Response({'detail': 'Algorithm must be dijkstra or astar.'}, status=status.HTTP_400_BAD_REQUEST)
    mode = request.data.get('travelMode', 'driving')
    if mode not in ('driving', 'cycling', 'walking'):
        return Response({'detail': 'Travel mode must be driving, cycling or walking.'}, status=status.HTTP_400_BAD_REQUEST)
    preference = request.data.get('preference', 'fastest')
    if preference not in ('fastest', 'shortest'):
        return Response({'detail': 'Preference must be fastest or shortest.'}, status=status.HTTP_400_BAD_REQUEST)
    network = get_network()
    observations = _latest_observations()
    closures = _active_closures()
    # Request-scoped simulations never overwrite operator or provider observations.
    simulation = request.data.get('simulation', {})
    factors = _traffic_factors(network, observations)
    for road_id, factor in simulation.get('roadFactors', {}).items() if isinstance(simulation, dict) else []:
        try:
            if float(factor) < 0.25 or float(factor) > 5: raise ValueError()
            factors[str(road_id)] = float(factor)
        except (TypeError, ValueError):
            return Response({'detail': 'Road simulation factors must be between 0.25 and 5.'}, status=status.HTTP_400_BAD_REQUEST)
    result = find_route(network, start, end, algorithm, closures, factors, mode, preference)
    if result['reachable']:
        normal = find_route(network, start, end, algorithm, set(), {}, mode, preference)
        if normal['reachable']:
            result['normalTimeMinutes'] = normal['travelTimeMinutes']
            result['timeSavedMinutes'] = round(max(0, normal['travelTimeMinutes'] - result['travelTimeMinutes']), 1)
            result['delayMinutes'] = round(max(0, result['travelTimeMinutes'] - normal['travelTimeMinutes']), 1)
        used_roads = {segment['roadId'] for segment in result['segments']}
        alternative = find_route(network, start, end, algorithm, closures | used_roads, factors, mode, preference)
        result['alternativeRoutes'] = [alternative] if alternative['reachable'] else []
    else:
        result['alternativeRoutes'] = []
    result['dataSource'] = 'simulation' if network['source'] == 'simulation_fallback' or all(item.is_simulated for item in observations.values()) else 'manual/provider observations'
    result['isSimulated'] = result['dataSource'] == 'simulation'
    result['closedRoads'] = sorted(closures)
    result['networkSource'] = network['sourceLabel']
    result['updatedAt'] = timezone.now().isoformat()
    if settings.TRAFFIC_PROVIDER == 'google_routes' and settings.GOOGLE_ROUTES_API_KEY:
        try:
            result['providerComparison'] = google_traffic_route(CORRIDOR[start], CORRIDOR[end], {'driving': 'DRIVE', 'cycling': 'BICYCLE', 'walking': 'WALK'}[mode])
        except requests.RequestException:
            result['providerWarning'] = 'Google Routes is configured but unavailable; using the local graph result.'
    return Response(result)

class IncidentViewSet(viewsets.ModelViewSet):
    queryset = Incident.objects.all().order_by('-reported_at')
    serializer_class = IncidentSerializer
    permission_classes = [OperatorWritePermission]
    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        incident = self.get_object()
        incident.status = Incident.Status.RESOLVED
        incident.resolved_at = timezone.now()
        incident.save(update_fields=['status', 'resolved_at'])
        return Response(self.get_serializer(incident).data)

@api_view(['GET', 'POST'])
@permission_classes([OperatorWritePermission])
def traffic_view(request):
    network = get_network()
    if request.method == 'POST':
        serializer = TrafficInputSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        item, _ = TrafficObservation.objects.update_or_create(road_id=data['road_id'], source=data['source'], defaults={
            'speed_kph': data['speed_kph'], 'congestion': 'heavy' if data['speed_kph'] < 15 else 'moderate' if data['speed_kph'] < 30 else 'normal',
            'is_simulated': data['source'] == 'simulation', 'details': {'enteredBy': 'operator'},
        })
        return Response({'roadId': item.road_id, 'speedKph': item.speed_kph, 'source': item.get_source_display(), 'isSimulated': item.is_simulated, 'lastUpdated': item.observed_at.isoformat()}, status=status.HTTP_201_CREATED)
    road_id = request.query_params.get('road_id')
    if road_id and settings.TOMTOM_API_KEY:
        feature = next((item for item in network['features']['features'] if item['properties']['roadId'] == road_id), None)
        if feature:
            coords = feature['geometry']['coordinates']; middle = coords[len(coords) // 2]
            try:
                value = tomtom_flow({'lat': middle[1], 'lon': middle[0]})
                if value and value.get('speedKph'):
                    TrafficObservation.objects.update_or_create(road_id=road_id, source=TrafficObservation.Source.TOMTOM,
                        defaults={'speed_kph': value['speedKph'], 'congestion': 'normal', 'is_simulated': False, 'details': value})
            except requests.RequestException:
                pass
    return Response({'sourceStatus': provider_status(), 'roads': _traffic_view(network)})

@api_view(['GET', 'POST'])
@permission_classes([OperatorWritePermission])
def signals_view(request):
    if request.method == 'POST':
        serializer = SignalInputSerializer(data=request.data); serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        item = SignalMeasurement.objects.create(**data, source='manual')
    else:
        item = SignalMeasurement.objects.order_by('-measured_at').first()
        data = {'junction_code': 'D', 'junction_name': 'Ibbaluru', 'vehicle_count': 88, 'average_wait_seconds': 74, 'queue_length_m': 108, 'cycle_duration_seconds': 90}
        if item:
            data = {'junction_code': item.junction_code, 'junction_name': item.junction_name, 'vehicle_count': item.vehicle_count,
                'average_wait_seconds': item.average_wait_seconds, 'queue_length_m': item.queue_length_m, 'cycle_duration_seconds': item.cycle_duration_seconds}
    count, wait, queue, cycle = data['vehicle_count'], data['average_wait_seconds'], data['queue_length_m'], data['cycle_duration_seconds']
    score = min(100, round(count * 0.25 + wait * 0.2 + queue * 0.15 + count / max(cycle, 1) * 20))
    recommended_cycle = max(45, min(150, round(50 + score * 0.65)))
    green = max(20, min(recommended_cycle - 15, round(recommended_cycle * (0.35 + score / 220))))
    payload = {'measurement': data, 'congestionScore': score, 'level': 'critical' if score >= 80 else 'high' if score >= 60 else 'moderate' if score >= 35 else 'normal',
        'recommendedCycleSeconds': recommended_cycle, 'suggestedGreenSeconds': green, 'source': 'manual' if item else 'simulation example',
        'explanation': 'Educational timing estimate only. This prototype does not control any traffic signals.'}
    return Response(payload, status=status.HTTP_201_CREATED if request.method == 'POST' else status.HTTP_200_OK)

@api_view(['GET', 'POST'])
@permission_classes([OperatorWritePermission])
def sensors_view(request):
    if request.method == 'POST':
        active_sites = request.data.get('activeSites')
        disabled_connections = request.data.get('disabledConnectionIds', [])
        if not isinstance(active_sites, list) or not all(isinstance(code, str) for code in active_sites):
            return Response({'detail': 'activeSites must be a list of junction codes.'}, status=status.HTTP_400_BAD_REQUEST)
        valid_codes = set(SensorSite.objects.values_list('code', flat=True))
        if not set(active_sites).issubset(valid_codes):
            return Response({'detail': 'One or more sensor site codes are unknown.'}, status=status.HTTP_400_BAD_REQUEST)
        SensorSite.objects.exclude(code__in=active_sites).update(candidate=False)
        SensorSite.objects.filter(code__in=active_sites).update(candidate=True)
        if isinstance(disabled_connections, list):
            SensorConnection.objects.all().update(connected=True)
            SensorConnection.objects.filter(id__in=disabled_connections).update(connected=False)
        sites = SensorSite.objects.all().order_by('code')
        connections = SensorConnection.objects.select_related('site_a', 'site_b').all()
        return Response({'sites': SensorSiteSerializer(sites, many=True).data, 'connections': SensorConnectionSerializer(connections, many=True).data})
    sites = SensorSite.objects.all().order_by('code')
    connections = SensorConnection.objects.select_related('site_a', 'site_b').all()
    return Response({'sites': SensorSiteSerializer(sites, many=True).data, 'connections': SensorConnectionSerializer(connections, many=True).data,
        'dataSource': 'Planning estimates · modeled installation costs', 'updatedAt': timezone.now().isoformat()})

@api_view(['POST'])
@permission_classes([OperatorWritePermission])
def sensor_optimize_view(request):
    serializer = OptimizeSensorSerializer(data=request.data); serializer.is_valid(raise_exception=True)
    sites = list(SensorSite.objects.filter(candidate=True).values('code', 'name', 'latitude', 'longitude'))
    site_codes = {item['code'] for item in sites}
    connections = [{'id': str(item.id), 'a': item.site_a.code, 'b': item.site_b.code, 'distanceM': item.distance_m,
        'installCost': float(item.install_cost), 'maintenanceCostYear': float(item.maintenance_cost_year), 'connected': item.connected}
        for item in SensorConnection.objects.select_related('site_a', 'site_b').all() if item.site_a.code in site_codes and item.site_b.code in site_codes]
    try:
        multiplier = float(request.data.get('costMultiplier', 1))
        if not .25 <= multiplier <= 4: raise ValueError()
    except (TypeError, ValueError):
        return Response({'detail': 'costMultiplier must be between 0.25 and 4.'}, status=status.HTTP_400_BAD_REQUEST)
    connections = [{**item, 'installCost': item['installCost'] * multiplier, 'maintenanceCostYear': item['maintenanceCostYear'] * multiplier} for item in connections]
    result = sensor_mst(sites, connections, serializer.validated_data['algorithm'], serializer.validated_data['redundant'])
    result['dataSource'] = 'modeled infrastructure cost estimates'; result['updatedAt'] = timezone.now().isoformat()
    return Response(result)

@api_view(['GET'])
@permission_classes([AllowAny])
def analytics_view(request):
    network = get_network()
    traffic = _traffic_view(network)
    incidents = Incident.objects.filter(status=Incident.Status.ACTIVE)
    sensor_total = SensorConnection.objects.filter(connected=True).aggregate(total=Sum('install_cost'))['total'] or 0
    current_route = find_route(network, 'A', 'G', closed_roads=_active_closures(), factors=_traffic_factors(network))
    profile = [{'hour': f'{hour:02d}:00', 'congestionIndex': value} for hour, value in [(7, 38), (9, 77), (12, 48), (16, 61), (18, 89), (21, 42)]]
    return Response({'networkSource': network['sourceLabel'], 'trafficSource': 'Simulation · modeled profile' if all(item['isSimulated'] for item in traffic) else 'Mixed simulated and observed data',
        'lastUpdated': timezone.now().isoformat(), 'summary': {'junctionCount': len(network['junctions']), 'roadCount': len(network['features']['features']),
            'activeIncidents': incidents.count(), 'blockedRoads': len(_active_closures()), 'estimatedAtoGMinutes': current_route['travelTimeMinutes'],
            'sensorConnectionsCost': float(sensor_total)}, 'roads': traffic, 'congestionTrend': profile,
        'trendDisclaimer': 'Illustrative simulation profile; no historical live sensor feed is connected.'})

@api_view(['GET'])
@permission_classes([AllowAny])
def report_view(request):
    network = get_network(); route = find_route(network, 'A', 'G', closed_roads=_active_closures(), factors=_traffic_factors(network))
    sites = list(SensorSite.objects.filter(candidate=True).values('code', 'name', 'latitude', 'longitude'))
    connections = [{'id': str(item.id), 'a': item.site_a.code, 'b': item.site_b.code, 'distanceM': item.distance_m,
        'installCost': float(item.install_cost), 'maintenanceCostYear': float(item.maintenance_cost_year), 'connected': item.connected}
        for item in SensorConnection.objects.select_related('site_a', 'site_b').all()]
    return Response({'reportTitle': 'SmartFlow Bengaluru · Traffic Operations Summary', 'generatedAt': timezone.now().isoformat(),
        'trafficSource': 'Simulation/manual/provider source is included per road; no simulated observation is labeled live.',
        'networkSource': network['sourceLabel'], 'selectedRoute': route, 'roads': _traffic_view(network),
        'incidents': IncidentSerializer(Incident.objects.all().order_by('-reported_at')[:50], many=True).data,
        'sensorNetwork': sensor_mst(sites, connections), 'signalMeasurements': list(SignalMeasurement.objects.order_by('-measured_at').values()[:30])})
