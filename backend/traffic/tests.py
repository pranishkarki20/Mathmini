from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from unittest.mock import patch
from .services.algorithms import find_route, sensor_mst
from .services.network import fallback_network

class RouteAlgorithmTests(TestCase):
    def setUp(self):
        self.network = fallback_network()

    def test_dijkstra_default_route_is_17_minutes(self):
        result = find_route(self.network, 'A', 'G')
        self.assertEqual(result['travelTimeMinutes'], 17)
        self.assertEqual(result['path'], ['A', 'C', 'B', 'D', 'E', 'F', 'G'])

    def test_astar_agrees_with_dijkstra(self):
        dijkstra = find_route(self.network, 'A', 'G', 'dijkstra')
        astar = find_route(self.network, 'A', 'G', 'astar')
        self.assertEqual(astar['travelTimeMinutes'], dijkstra['travelTimeMinutes'])

    def test_blocked_bd_recalculates_to_nineteen(self):
        result = find_route(self.network, 'A', 'G', closed_roads={'model-BD'})
        self.assertEqual(result['travelTimeMinutes'], 19)
        self.assertNotIn('model-BD', {item['roadId'] for item in result['segments']})

    def test_sensor_prim_and_kruskal_are_connected_minimum_backbones(self):
        sites = [{'code': item} for item in 'ABCD']
        connections = [
            {'id': 'ab', 'a': 'A', 'b': 'B', 'installCost': 4, 'maintenanceCostYear': 1, 'connected': True},
            {'id': 'ac', 'a': 'A', 'b': 'C', 'installCost': 2, 'maintenanceCostYear': 1, 'connected': True},
            {'id': 'bc', 'a': 'B', 'b': 'C', 'installCost': 1, 'maintenanceCostYear': 1, 'connected': True},
            {'id': 'bd', 'a': 'B', 'b': 'D', 'installCost': 5, 'maintenanceCostYear': 1, 'connected': True},
            {'id': 'cd', 'a': 'C', 'b': 'D', 'installCost': 8, 'maintenanceCostYear': 1, 'connected': True},
        ]
        kruskal = sensor_mst(sites, connections, 'kruskal')
        prim = sensor_mst(sites, connections, 'prim')
        self.assertTrue(kruskal['connected']); self.assertTrue(prim['connected'])
        self.assertEqual(kruskal['totalInstallCost'], 8); self.assertEqual(prim['totalInstallCost'], 8)
        self.assertEqual(kruskal['connectionCount'], 3); self.assertEqual(prim['connectionCount'], 3)

@override_settings(OSM_AUTO_FETCH=False, ALLOW_DEMO_WRITES=True)
class ApiFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_route_endpoint_returns_path_and_algorithm_trace(self):
        response = self.client.post('/api/routes/', {
            'start': 'A', 'destination': 'G', 'algorithm': 'astar',
            'travelMode': 'driving', 'preference': 'fastest',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['reachable'])
        self.assertEqual(response.data['travelTimeMinutes'], 17)
        self.assertTrue(response.data['steps'])

    def test_closure_incident_changes_following_route(self):
        response = self.client.post('/api/incidents/', {
            'road_id': 'model-BD', 'location_name': 'Agara', 'latitude': 12.92, 'longitude': 77.65,
            'kind': 'closure', 'severity': 'high', 'description': 'Demonstration closure',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        route = self.client.post('/api/routes/', {
            'start': 'A', 'destination': 'G', 'algorithm': 'dijkstra',
            'travelMode': 'driving', 'preference': 'fastest',
        }, format='json')
        self.assertEqual(route.status_code, 200)
        self.assertNotIn('model-BD', {segment['roadId'] for segment in route.data['segments']})
        self.assertIn('model-BD', route.data['closedRoads'])


@override_settings(OSRM_BASE_URL='http://osrm.test', NOMINATIM_USER_AGENT='SmartFlow-tests/1.0')
class GeoServiceApiTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.client = APIClient()

    @patch('traffic.services.osm_services.requests.get')
    def test_nominatim_search_returns_global_places_and_is_cached(self, get):
        get.return_value.raise_for_status.return_value = None
        get.return_value.json.return_value = [{
            'place_id': 7, 'osm_type': 'node', 'osm_id': 8, 'name': 'Jain University',
            'display_name': 'Jain University, Bengaluru, India', 'lat': '12.84', 'lon': '77.66',
            'category': 'amenity', 'type': 'university',
        }]
        first = self.client.get('/api/places/search/', {'q': 'Jain University Bengaluru'})
        again = self.client.get('/api/places/search/', {'q': 'Jain University Bengaluru'})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(again.data['results'][0]['latitude'], 12.84)
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.kwargs['params']['format'], 'jsonv2')
        self.assertEqual(get.call_args.kwargs['headers']['User-Agent'], 'SmartFlow-tests/1.0')

    @patch('traffic.services.osm_services.requests.get')
    def test_osrm_routes_accept_unrelated_worldwide_coordinate_pairs(self, get):
        get.return_value.raise_for_status.return_value = None
        get.return_value.json.return_value = {'code': 'Ok', 'routes': [{
            'distance': 230000, 'duration': 9000,
            'geometry': {'type': 'LineString', 'coordinates': [[77.59, 12.97], [76.64, 12.30]]},
            'legs': [{'summary': 'Highway', 'distance': 230000, 'duration': 9000, 'steps': []}],
        }]}
        pairs = [
            ([{'latitude': 12.84, 'longitude': 77.66}, {'latitude': 13.20, 'longitude': 77.70}], 'jain', 'airport'),
            ([{'latitude': 12.97, 'longitude': 77.59}, {'latitude': 12.30, 'longitude': 76.64}], 'bengaluru', 'mysuru'),
            ([{'latitude': -33.87, 'longitude': 151.20}, {'latitude': -37.81, 'longitude': 144.96}], 'sydney', 'melbourne'),
        ]
        for coordinates, origin, destination in pairs:
            response = self.client.post('/api/routes/osrm/', {'coordinates': coordinates, 'alternatives': True}, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['source'], 'OSRM · OpenStreetMap road data')
            self.assertTrue(response.data['routes'][0]['geometry']['coordinates'])
            self.assertIn(origin, destination + origin)
        urls = [call.args[0] for call in get.call_args_list]
        self.assertEqual(len(urls), 3)
        self.assertIn('151.2,-33.87', urls[2])
        self.assertTrue(all(call.kwargs['params']['alternatives'] == 'true' for call in get.call_args_list))

    @patch('traffic.services.area_network.get_area_network')
    def test_closing_a_real_graph_road_recalculates_to_an_alternative(self, get_network):
        get_network.return_value = {'edges': [
            {'id': 'ab', 'roadId': 'road-ab', 'name': 'A-B', 'a': 'A', 'b': 'B', 'distanceM': 2, 'coordinates': [[0, 0], [1, 0]], 'oneway': False},
            {'id': 'bd', 'roadId': 'road-bd', 'name': 'B-D', 'a': 'B', 'b': 'D', 'distanceM': 2, 'coordinates': [[1, 0], [2, 0]], 'oneway': False},
            {'id': 'ac', 'roadId': 'road-ac', 'name': 'A-C', 'a': 'A', 'b': 'C', 'distanceM': 3, 'coordinates': [[0, 0], [0, 1]], 'oneway': False},
            {'id': 'cd', 'roadId': 'road-cd', 'name': 'C-D', 'a': 'C', 'b': 'D', 'distanceM': 4, 'coordinates': [[0, 1], [2, 0]], 'oneway': False},
        ]}
        response = self.client.post('/api/network/area/route/', {'bbox': [1, 1, 1.05, 1.05], 'start': 'A', 'destination': 'D'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['distanceMeters'], 4)
        closed = self.client.post('/api/network/area/route/', {'bbox': [1, 1, 1.05, 1.05], 'start': 'A', 'destination': 'D', 'closedRoadIds': ['road-ab']}, format='json')
        self.assertTrue(closed.data['reachable'])
        self.assertEqual(closed.data['distanceMeters'], 7)
        disconnected = self.client.post('/api/network/area/route/', {'bbox': [1, 1, 1.05, 1.05], 'start': 'A', 'destination': 'D', 'closedRoadIds': ['road-ab', 'road-ac']}, format='json')
        self.assertFalse(disconnected.data['reachable'])

    @patch('traffic.services.area_network.get_area_network')
    def test_infrastructure_plan_uses_osm_road_distance_and_entered_cost(self, get_network):
        get_network.return_value = {'edges': [
            {'id': 'ab', 'roadId': 'road-ab', 'name': 'A-B', 'a': 'A', 'b': 'B', 'distanceM': 1000, 'coordinates': [[0, 0], [1, 0]], 'oneway': False},
            {'id': 'bc', 'roadId': 'road-bc', 'name': 'B-C', 'a': 'B', 'b': 'C', 'distanceM': 1000, 'coordinates': [[1, 0], [2, 0]], 'oneway': False},
            {'id': 'ac', 'roadId': 'road-ac', 'name': 'A-C', 'a': 'A', 'b': 'C', 'distanceM': 4000, 'coordinates': [[0, 0], [2, 0]], 'oneway': False},
        ]}
        response = self.client.post('/api/infrastructure/plan/', {
            'bbox': [1, 1, 1.05, 1.05], 'junctionIds': ['A', 'C'], 'estimatedCostPerKm': 100000,
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['connected'])
        self.assertEqual(response.data['totalDistanceMeters'], 2000)
        self.assertEqual(response.data['estimatedInstallationCost'], 200000)
        self.assertEqual(len(response.data['connections'][0]['segments']), 2)

