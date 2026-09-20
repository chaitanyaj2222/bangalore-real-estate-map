# Bangalore Real Estate Map

An interactive map of upcoming residential projects in Bengaluru, in the spirit of
[bangalorestartupmap.com](https://www.bangalorestartupmap.com/). Frontend and backend
live in this one repo.

Currently seeded with **37 projects** from **Godrej Properties**, **Prestige Group**
and **Assetz Property Group**, served from JSON on the backend. No database.

## Run it

```bash
npm install
npm start          # http://localhost:4000
npm run dev        # same, with auto-restart on file changes
npm run validate   # sanity-check the data set
```

Port 4000 is the default because 3000 is commonly taken; override with `PORT=8080 npm start`.

## How it fits together

```
server/
  index.js            Express app: serves /api and the static frontend
  routes/projects.js  HTTP layer - query parsing, sorting, JSON responses
  lib/store.js        Loads the JSON once, indexes it, does all filtering
  lib/validate.js     Data sanity checks (npm run validate)
  data/
    builders.json     Builder names, brand colours, websites
    projects.json     The project records
web/
  index.html          Page shell
  styles.css          All styling, no framework
  app.js              Leaflet map, filters, results list, detail panel
```

`lib/store.js` is the only module that touches the JSON files. Swapping in Postgres
later means rewriting `load()` and the query helpers there; nothing else changes.

## API

| Endpoint | What it returns |
| --- | --- |
| `GET /api/projects` | Filtered, sorted project list |
| `GET /api/projects.geojson` | Same results as a GeoJSON `FeatureCollection` |
| `GET /api/projects/:id` | One project |
| `GET /api/builders` | Builders with project counts |
| `GET /api/facets` | Distinct filter values with counts, and the price range |
| `GET /api/stats` | Totals by builder and by zone |
| `GET /healthz` | Liveness check |

### Query parameters

Accepted by `/api/projects` and `/api/projects.geojson`:

| Param | Example | Notes |
| --- | --- | --- |
| `builder` | `builder=godrej,prestige` | Builder ids; repeat or comma-separate |
| `zone` | `zone=East` | North, North East, East, South East, South, South West |
| `type` | `type=Apartment` | Apartment, Plotted, Villa, Township |
| `status` | `status=New launch` | |
| `config` | `config=3 BHK` | Matches if the project offers it |
| `minPrice` / `maxPrice` | `maxPrice=1.5` | Crore. Matches overlapping bands, not just midpoints |
| `q` | `q=whitefield` | Substring search over name, locality, corridor, zone, builder |
| `sort` | `sort=price_asc` | `name`, `newest`, `price_asc`, `price_desc`, `size` |

```bash
curl 'http://localhost:4000/api/projects?builder=assetz&zone=North&sort=price_asc'
```

## Frontend behaviour

- Filter state lives in the URL, so any view is shareable:
  `/?builder=prestige&zone=East&project=prestige-park-grove` opens filtered with that
  project's detail panel already open.
- Pin colour is the builder; pin diameter scales with unit count, so townships read
  bigger than boutique blocks.
- The map reframes to the filtered results, except while a project is selected.
- Below 720px the sidebar and map swap via the Map/List toggle.

Tiles are keyless OpenStreetMap raster tiles. OSM's
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) covers
development and light traffic; for anything public-facing, sign up with a tile
provider and swap the URL and attribution in the `L.tileLayer` call in `web/app.js`.

## About the data

**The project data is indicative, not authoritative.** It was compiled from publicly
announced launches, and:

- Coordinates are locality-level approximations, not surveyed plot boundaries.
- Price and size bands are ballpark figures, not quotes.
- `rera` is `null` on every record rather than filled with an unverified number.

Treat it as a starting schema to replace with verified data. Do not make a purchase
decision from it.

### Adding or editing projects

Edit `server/data/projects.json` and restart (or use `npm run dev`). Each record:

```jsonc
{
  "id": "builder-project-name",     // unique slug
  "name": "Project Name",
  "builderId": "godrej",            // must exist in builders.json
  "locality": "Budigere Cross",
  "corridor": "Old Madras Road",
  "zone": "East",
  "lat": 13.0341, "lng": 77.7468,
  "propertyType": "Apartment",      // Apartment | Plotted | Villa | Township
  "status": "Under construction",   // Under construction | New launch | Pre-launch
  "configurations": ["2 BHK", "3 BHK"],
  "priceMinCr": 1.15, "priceMaxCr": 2.6,
  "sizeMinSqft": 1050, "sizeMaxSqft": 2100,
  "landAcres": 18, "totalUnits": 1200,
  "launchYear": 2023, "possession": "2028",
  "highlights": ["Short selling points"]
}
```

Adding a builder means adding an entry to `builders.json` with an `id`, `name`,
`shortName`, `color` and `website`. Filter chips, the legend and the stats bar all
build themselves from the data, so no frontend change is needed.

Run `npm run validate` afterwards - it checks required fields, duplicate ids,
coordinates inside the Bengaluru bounding box, and inverted price/size ranges.
