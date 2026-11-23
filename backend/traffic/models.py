from django.conf import settings
from django.db import models

class RoadSegment(models.Model):
    osm_way_id = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=180, blank=True)
    highway_class = models.CharField(max_length=40, blank=True)
    length_m = models.FloatField(default=0)
    geometry = models.JSONField(default=list)
    oneway = models.BooleanField(default=False)
    source = models.CharField(max_length=40, default='osm')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name or self.osm_way_id

class TrafficObservation(models.Model):
    class Source(models.TextChoices):
        SIMULATION = 'simulation', 'Simulation'
        MANUAL = 'manual', 'Manual operator entry'
        GOOGLE = 'google_routes', 'Google Routes'
        TOMTOM = 'tomtom', 'TomTom Traffic'
    road_id = models.CharField(max_length=80, db_index=True)
    speed_kph = models.FloatField(null=True, blank=True)
    travel_time_seconds = models.FloatField(null=True, blank=True)
    congestion = models.CharField(max_length=24, default='normal')
    source = models.CharField(max_length=24, choices=Source.choices, default=Source.SIMULATION)
    is_simulated = models.BooleanField(default=True)
    observed_at = models.DateTimeField(auto_now=True)
    details = models.JSONField(default=dict, blank=True)

class Incident(models.Model):
    class Kind(models.TextChoices):
        ACCIDENT = 'accident', 'Road accident'
        CONSTRUCTION = 'construction', 'Road construction'
        WATERLOGGING = 'waterlogging', 'Waterlogging'
        BREAKDOWN = 'breakdown', 'Broken-down vehicle'
        CLOSURE = 'closure', 'Road closure'
        SIGNAL = 'signal_failure', 'Traffic signal failure'
    class Severity(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        CRITICAL = 'critical', 'Critical'
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        RESOLVED = 'resolved', 'Resolved'
    road_id = models.CharField(max_length=80, blank=True, db_index=True)
    location_name = models.CharField(max_length=160)
    latitude = models.FloatField()
    longitude = models.FloatField()
    kind = models.CharField(max_length=24, choices=Kind.choices)
    severity = models.CharField(max_length=12, choices=Severity.choices, default=Severity.MEDIUM)
    description = models.CharField(max_length=500)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    reported_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

class SensorSite(models.Model):
    code = models.CharField(max_length=8, unique=True)
    name = models.CharField(max_length=140)
    latitude = models.FloatField()
    longitude = models.FloatField()
    candidate = models.BooleanField(default=True)
    active = models.BooleanField(default=True)
    install_cost = models.DecimalField(max_digits=12, decimal_places=2, default=100000)
    maintenance_cost_year = models.DecimalField(max_digits=12, decimal_places=2, default=12000)

class SensorConnection(models.Model):
    site_a = models.ForeignKey(SensorSite, related_name='connections_from', on_delete=models.CASCADE)
    site_b = models.ForeignKey(SensorSite, related_name='connections_to', on_delete=models.CASCADE)
    distance_m = models.FloatField()
    install_cost = models.DecimalField(max_digits=12, decimal_places=2)
    maintenance_cost_year = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    connected = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['site_a', 'site_b'], name='unique_sensor_connection')]

class SignalMeasurement(models.Model):
    junction_code = models.CharField(max_length=16)
    junction_name = models.CharField(max_length=140)
    vehicle_count = models.PositiveIntegerField(default=0)
    average_wait_seconds = models.PositiveIntegerField(default=0)
    queue_length_m = models.PositiveIntegerField(default=0)
    cycle_duration_seconds = models.PositiveIntegerField(default=90)
    source = models.CharField(max_length=24, default='simulation')
    measured_at = models.DateTimeField(auto_now=True)
