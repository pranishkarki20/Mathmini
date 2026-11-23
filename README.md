# SmartFlow Road Network Optimization Platform

SmartFlow is a practical road-network operations prototype built on OpenStreetMap. It combines a Leaflet map, user-submitted Nominatim place searches, OSRM driving estimates, cached Overpass extracts, temporary road-closure scenarios, and sensor-connectivity planning. It does not claim to provide live traffic conditions.

## Current capabilities

- Search for arbitrary mapped places, select a start and destination, use an optional device location, and view OSRM route alternatives on an OpenStreetMap map.
- Explore a selected map area and load its actual OSM roads from Overpass. Extracts are bounded and cached locally.
- Click roads to simulate closures, then compare shortest-distance connectivity before and after closures on the downloaded road graph. Critical junctions and disconnected areas are summarized in plain language.
- Plan candidate monitoring connections and view estimated installation costs. Estimates are explicitly labeled.
- Manage incident reports, view network analytics, and export an operations JSON report.

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
python manage.py seed_demo
python manage.py runserver
```

The API runs at `http://127.0.0.1:8000/api/`. SQLite is the local default. Set `DATABASE_URL` for PostgreSQL. `OSRM_BASE_URL` can point at a self-hosted OSRM instance; the default public OSRM demo endpoint has no production SLA.

### Frontend

In a second terminal at the project root:

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Set `VITE_API_BASE_URL` to the Django API URL if it differs from the local default. Vercel can use `npm ci`, `npm run build`, and `dist` as the output directory. Deploy Django separately and configure its CORS origins for the frontend domain.

## Public service limits and data accuracy

- Nominatim search is submitted explicitly; the application does not send autocomplete requests. The backend caches searches and spaces uncached public Nominatim requests to at least one second apart. For a busy production service, use a contracted or self-hosted geocoder.
- OSRM durations are routing estimates from the configured road profile, not traffic-aware durations. The UI states this alongside the result. The public OSRM demo service is intended for demonstration; use a managed or self-hosted deployment for operational use.
- Overpass area extracts are capped at 0.12 degrees per side and cached under `backend/data/areas`. OSM road geometry does not include live speeds or incident reports.
- A simulated road closure affects only the extracted graph route calculation. It does not alter OSRM's hosted road graph or represent an official road closure.
- Estimated sensor installation costs are planning inputs, not vendor quotations. Configure and review cost data before using it for a budget.
- OpenStreetMap data is © OpenStreetMap contributors and available under the Open Database License. Preserve attribution and comply with the relevant service policies.

## API endpoints

- `GET /api/places/search/?q=...` — user-submitted place search via Nominatim.
- `POST /api/routes/osrm/` — OSRM route and alternatives for supplied coordinates.
- `GET /api/network/area/?south=...&west=...&north=...&east=...` — fetch or reuse a cached OSM road graph extract.
- `POST /api/network/area/route/` — calculate a shortest-distance path on that extract with optional closed road IDs.
- `POST /api/incidents/`, `GET /api/incidents/` — incident management.

## Checks

```powershell
npm run build
cd backend
python manage.py check
python manage.py test traffic
```
