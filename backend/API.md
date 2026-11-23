# SmartFlow API

Base URL: `http://127.0.0.1:8000/api/`. All responses are JSON. The health and network endpoints report OSM network source and provider configuration without returning keys. Traffic is marked simulated unless a provider or operator observation is actually stored.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health/` | Backend, data-source and provider status |
| GET | `/network/` | Junctions, network GeoJSON, graph edges, traffic and incidents |
| GET | `/network/?refresh=1` | Ask the backend to refresh its OSM extract |
| POST | `/routes/` | Dijkstra or A* route; body: `start`, `destination`, `algorithm`, `travelMode`, `preference`, optional `simulation.roadFactors` |
| GET/POST | `/incidents/` | List/create incidents; `POST /incidents/{id}/resolve/` resolves one |
| GET/POST | `/traffic/` | View road conditions or enter a manual/simulation speed |
| GET/POST | `/signals/` | View advisory analysis or submit counts/queue measurements |
| GET/POST | `/sensors/` | View sensor planning network or set `activeSites` and `disabledConnectionIds` |
| POST | `/sensors/optimize/` | Prim/Kruskal MST; body: `algorithm`, `redundant`, optional `costMultiplier` |
| GET | `/analytics/` | Modeled traffic profile and network aggregates |
| GET | `/reports/` | Exportable JSON operations report |

Writes are available anonymously only when `DEBUG=true` and `ALLOW_DEMO_WRITES=true` (the local demo defaults). For deployment, disable that option and authenticate with Django Basic or Session auth as a staff user or a user in the `Administrator` or `Traffic operator` group. The frontend role selector is a presentation control, not an authentication mechanism. Create an admin account with `python manage.py createsuperuser`, then assign a group in Django admin.

Route costs use the network edge's estimated time or distance. A closure and a critical accident block an edge. Cycling/walking speeds, manual measurements, and sensor costs are educational estimates. Signal output is advisory and is not connected to signal controllers. The congestion trend is illustrative, not historical sensor data.
