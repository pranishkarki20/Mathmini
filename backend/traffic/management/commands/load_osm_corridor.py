import json
from django.core.management.base import BaseCommand, CommandError
from traffic.services.network import _cache_path, fetch_osm_network

class Command(BaseCommand):
    help = 'Fetch and locally cache the OSM road network for the Bengaluru study corridor.'
    def handle(self, *args, **options):
        try:
            network = fetch_osm_network(timeout=35)
        except Exception as exc:
            raise CommandError(f'OSM extract could not be downloaded: {exc}') from exc
        if not network['edges']:
            raise CommandError('The OSM query returned no routable road segments.')
        cache = _cache_path(); cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(network), encoding='utf-8')
        self.stdout.write(self.style.SUCCESS(f"Cached {len(network['features']['features'])} OSM roads and {len(network['edges'])} routable segments."))
