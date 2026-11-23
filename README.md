# SmartFlow Road Network Optimization Platform

SmartFlow explores real OpenStreetMap road networks and supports route estimates, graph connectivity analysis, road-closure scenarios, sensor-site planning, and editable infrastructure cost estimates. It does not provide live traffic measurements or control traffic signals.

## Modules

- **Dashboard:** service status and summary information where a real OSM network extract is available. No fictional road counts are substituted when services are offline.
- **Road network analysis:** search for a city, street, landmark or address; choose an area by moving and zooming the Leaflet map; load its roads from Overpass; inspect road classes, junctions, connected components, articulation points and bridge links; compare shortest-distance routes before and after simulated closures; save and restore closure scenarios. A CSV report and print-to-PDF view are available.
- **Route planner:** search any mapped origin and destination, select map pins, compare OSRM route alternatives, and review distance and estimated duration. These routes come from OSRM, not SmartFlow's graph algorithm.
- **Sensor infrastructure:** load a selected area, pick junctions on the map, review degree-based recommendations, calculate Prim/Kruskal minimum spanning connections, configure cost assumptions, save the plan, and export CSV or print/PDF.
- **Network analytics:** calculate graph node/edge counts, mapped distance, connected components, high-degree nodes and road-class distributions from a real OSM extract.

## Local setup

Requirements: Node.js 20+, Python 3.10+, and pip.

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python manage.py migrate
python manage.py runserver
```

The API runs at `http://127.0.0.1:8000/api/`. SQLite is the local default. Set `DATABASE_URL` for PostgreSQL. `OSRM_BASE_URL` can point at a self-hosted OSRM instance; the public demo endpoint has no production SLA.

### Frontend

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Set `VITE_API_BASE_URL` if the Django API differs from the local default. Vercel can use `npm ci`, `npm run build`, and `dist` as the output directory. Deploy Django separately and configure CORS for the frontend domain.

## Data and service limits

- Nominatim search happens only when submitted. The backend caches searches and spaces uncached requests to respect its public usage policy. Use a contracted or self-hosted geocoder for production traffic.
- Overpass extracts are bounded to at most 0.12 degrees per side and cached under `backend/data/areas`. Large regions require multiple extracts.
- OSRM durations are profile estimates, not traffic-aware or verified live travel times. Graph route durations use road-class speed assumptions.
- Simulated closures affect only the downloaded graph and are not official road closures. Sensor recommendations use road graph properties, not traffic demand or existing device data.
- Cost values are editable user-entered assumptions, not verified supplier prices. Use quotes before budgeting or procurement.
- OpenStreetMap data is © OpenStreetMap contributors under the Open Database License. Keep attribution visible and comply with provider policies.

## Checks

```powershell
npm run build
cd backend
python manage.py check
python manage.py test traffic
```
