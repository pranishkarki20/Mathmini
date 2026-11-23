from django.contrib import admin
from .models import Incident, RoadSegment, SensorConnection, SensorSite, SignalMeasurement, TrafficObservation

admin.site.register((RoadSegment, TrafficObservation, Incident, SensorSite, SensorConnection, SignalMeasurement))
