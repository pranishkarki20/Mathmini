# SmartFlow API

Base URL: `http://127.0.0.1:8000/api/`. Responses use JSON. The application has no default city or demo road graph; select an area explicitly.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health/` | Backend/provider status |
| GET | `/places/search/?q=...` | Submitted Nominatim search |
| POST | `/routes/osrm/` | OSRM route estimates and alternatives for coordinates |
| GET | `/network/area/?south=...&west=...&north=...&east=...` | Retrieve/cache a bounded OSM road graph |
| POST | `/network/area/route/` | Shortest-distance route on the selected graph, with optional closed road IDs |
| POST | `/infrastructure/plan/` | Prim/Kruskal minimum road connections between selected OSM junctions |
| GET/POST | `/sensor-plans/` | Read or save a selected sensor plan and editable cost assumptions |
| GET/POST | `/closure-scenarios/` | Read or save a user's selected-area road closure scenario |

Area bounds are validated and limited to 0.12 degrees per side to keep Overpass requests manageable. Road geometry, road classes, intersection coordinates and graph connectivity come from OpenStreetMap. A closure scenario affects only the graph extract in the request; it does not alter the OSM source or represent a real closure.

OSRM durations are route-profile estimates and do not include verified current congestion. Graph closure route durations use road-class speed assumptions. Sensor suggestions are based on graph connectivity, not measured traffic demand. All costs are user-entered assumptions; no verified supplier-price feed is integrated.

Nominatim requests are submitted explicitly, cached and rate-limited. Preserve OpenStreetMap attribution and comply with public service usage policies. Anonymous writes are allowed only when `DEBUG=true` and `ALLOW_DEMO_WRITES=true`; production deployments should disable demo writes and use Django authentication.
