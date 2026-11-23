from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import IncidentViewSet, analytics_view, health, network_view, report_view, route_view, sensor_optimize_view, sensors_view, signals_view, traffic_view

router = DefaultRouter()
router.register('incidents', IncidentViewSet, basename='incident')
urlpatterns = [
    path('health/', health), path('network/', network_view), path('routes/', route_view),
    path('traffic/', traffic_view), path('signals/', signals_view), path('sensors/', sensors_view),
    path('sensors/optimize/', sensor_optimize_view), path('analytics/', analytics_view),
    path('reports/', report_view), path('', include(router.urls)),
]
