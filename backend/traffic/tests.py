from django.test import TestCase, override_settings
from rest_framework.test import APIClient
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
