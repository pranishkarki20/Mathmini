from rest_framework import serializers

from .models import Incident, SensorConnection, SensorSite, SignalMeasurement, TrafficObservation

class IncidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Incident
        fields = ['id', 'road_id', 'location_name', 'latitude', 'longitude', 'kind', 'severity', 'description', 'status', 'reported_at', 'resolved_at']
        read_only_fields = ['id', 'status', 'reported_at', 'resolved_at']
    def validate_latitude(self, value):
        if not -90 <= value <= 90: raise serializers.ValidationError('Latitude must be between -90 and 90.')
        return value
    def validate_longitude(self, value):
        if not -180 <= value <= 180: raise serializers.ValidationError('Longitude must be between -180 and 180.')
        return value

class TrafficInputSerializer(serializers.Serializer):
    road_id = serializers.CharField(max_length=80)
    speed_kph = serializers.FloatField(min_value=1, max_value=160)
    source = serializers.ChoiceField(choices=['manual', 'simulation'], default='manual')

class SignalInputSerializer(serializers.Serializer):
    junction_code = serializers.CharField(max_length=16)
    junction_name = serializers.CharField(max_length=140)
    vehicle_count = serializers.IntegerField(min_value=0, max_value=10000)
    average_wait_seconds = serializers.IntegerField(min_value=0, max_value=3600)
    queue_length_m = serializers.IntegerField(min_value=0, max_value=5000)
    cycle_duration_seconds = serializers.IntegerField(min_value=20, max_value=600)

class OptimizeSensorSerializer(serializers.Serializer):
    algorithm = serializers.ChoiceField(choices=['prim', 'kruskal'], default='kruskal')
    redundant = serializers.BooleanField(default=False)

class SensorSiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = SensorSite
        fields = ['id', 'code', 'name', 'latitude', 'longitude', 'candidate', 'active', 'install_cost', 'maintenance_cost_year']

class SensorConnectionSerializer(serializers.ModelSerializer):
    a = serializers.CharField(source='site_a.code', read_only=True)
    b = serializers.CharField(source='site_b.code', read_only=True)
    class Meta:
        model = SensorConnection
        fields = ['id', 'a', 'b', 'distance_m', 'install_cost', 'maintenance_cost_year', 'connected']
