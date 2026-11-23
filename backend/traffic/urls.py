from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import IncidentViewSet, analytics_view, area_network_view, area_route_view, health, infrastructure_plan_view, network_view, osrm_route_view, place_search_view, report_view, route_view, sensor_optimize_view, sensors_view, signals_view, traffic_view

router = DefaultRouter()
router.register('incidents', IncidentViewSet, basename='incident')
urlpatterns = [
    path('health/', health), path('network/', network_view), path('network/area/', area_network_view),
    path('network/area/route/', area_route_view), path('infrastructure/plan/', infrastructure_plan_view), path('routes/', route_view),
    path('places/search/', place_search_view), path('routes/osrm/', osrm_route_view),
    path('traffic/', traffic_view), path('signals/', signals_view), path('sensors/', sensors_view),
    path('sensors/optimize/', sensor_optimize_view), path('analytics/', analytics_view),
    path('reports/', report_view), path('', include(router.urls)),
]
