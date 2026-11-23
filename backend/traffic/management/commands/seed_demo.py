from decimal import Decimal
from itertools import combinations

from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group
from traffic.models import SensorConnection, SensorSite
from traffic.services.network import CORRIDOR, haversine

class Command(BaseCommand):
    help = 'Create the corridor sensor candidate sites and modeled installation connections.'

    def handle(self, *args, **options):
        for group_name in ('Administrator', 'Traffic operator'):
            Group.objects.get_or_create(name=group_name)
        sites = {}
        for code, place in CORRIDOR.items():
            sites[code], _ = SensorSite.objects.update_or_create(code=code, defaults={
                'name': place['name'], 'latitude': place['lat'], 'longitude': place['lon'], 'candidate': True, 'active': True,
                'install_cost': Decimal('95000'), 'maintenance_cost_year': Decimal('7200'),
            })
        for a, b in combinations(sorted(sites), 2):
            left, right = CORRIDOR[a], CORRIDOR[b]
            distance = haversine([left['lon'], left['lat']], [right['lon'], right['lat']])
            cost = Decimal(str(round(65000 + distance * 46, 2)))
            maintenance = Decimal(str(round(float(cost) * .045, 2)))
            SensorConnection.objects.update_or_create(site_a=sites[a], site_b=sites[b], defaults={
                'distance_m': round(distance, 1), 'install_cost': cost, 'maintenance_cost_year': maintenance, 'connected': True,
            })
        self.stdout.write(self.style.SUCCESS(f'Seeded {len(sites)} candidate sensor sites and {len(sites) * (len(sites) - 1) // 2} modeled connections. Costs are estimates.'))
