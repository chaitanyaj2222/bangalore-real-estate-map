# Bangalore Real Estate Map

An interactive map of Bengaluru property, in the spirit of
[bangalorestartupmap.com](https://www.bangalorestartupmap.com/). Frontend and backend
live in this one repo.

Two modes, switched from the top bar:

- **Buy** — 37 upcoming residential projects from **Godrej Properties**, **Prestige Group**
  and **Assetz Property Group**.
- **Rent** — 29 rental homes shown Airbnb-style, with price pills on the map and a photo
  gallery in the side panel. **These are sample listings, not real inventory** — see
  [About the data](#about-the-data).

Both modes draw Bengaluru's ring roads (**ORR**, **NICE Road**, **PRR**, **STRR**) and its
arterial corridors, and both can show how far each property is from wherever you are.

Everything is served from JSON on the backend. No database.

## Run it

```bash
npm install
npm start          # http://localhost:4000
npm run dev        # same, with auto-restart on file changes
npm run validate   # sanity-check every data set
```

Port 4000 is the default because 3000 is commonly taken; override with `PORT=8080 npm start`.

## How it fits together

```
server/
  index.js             Express app: serves /api and the static frontend
  routes/projects.js   Sale projects, builders, facets, stats
  routes/rentals.js    Rentals and roads
  lib/store.js         Sale projects: load, filter, facet
  lib/rentals.js       Rentals: load, filter, facet, attach photos
  lib/roads.js         Road traces, and the GeoJSON conversion
  lib/validate.js      Data sanity checks (npm run validate)
  data/
    builders.json      Builder names, brand colours, websites
    projects.json      Sale project records
    rentals.json       Sample rental listings
    roads.json         Ring road and arterial waypoint traces
web/
  index.html           Page shell
  styles.css           All styling, no framework
  js/
    main.js            Boot, mode switching, URL state, shared chrome
    mapview.js         Leaflet setup, road overlays, viewer location
    buy.js             Buy mode: markers, filters, list, detail
    rent.js            Rent mode: price pills, cards, gallery, detail
    api.js             Fetch wrappers
    util.js            DOM building, formatting, distance maths
```

The `lib/*.js` modules are the only ones that touch the JSON files. Swapping in Postgres
later means rewriting their loaders and query helpers; nothing else changes.

## API

| Endpoint | What it returns |
| --- | --- |
| `GET /api/projects` | Filtered, sorted sale projects |
| `GET /api/projects.geojson` | Same results as a GeoJSON `FeatureCollection` |
| `GET /api/projects/:id` | One project |
| `GET /api/builders` | Builders with project counts |
| `GET /api/facets` | Distinct project filter values with counts |
| `GET /api/stats` | Totals by builder and by zone |
| `GET /api/rentals` | Filtered, sorted rental listings |
| `GET /api/rentals.geojson` | Rentals as GeoJSON |
| `GET /api/rentals/facets` | Rental filter values, rent range, counts |
| `GET /api/rentals/:id` | One listing, with its photos |
| `GET /api/roads` | Road traces as `[lat, lng]` paths |
| `GET /api/roads.geojson` | Roads as GeoJSON `LineString`s (`?category=ring`) |
| `GET /healthz` | Liveness check |

### Query parameters

`/api/projects` and `/api/projects.geojson`:

| Param | Example | Notes |
| --- | --- | --- |
| `builder` | `builder=godrej,prestige` | Builder ids; repeat or comma-separate |
| `zone` | `zone=East` | North, North East, East, South East, South, South West |
| `type` | `type=Apartment` | Apartment, Plotted, Villa, Township |
| `status` | `status=New launch` | |
| `config` | `config=3 BHK` | Matches if the project offers it |
| `minPrice` / `maxPrice` | `maxPrice=1.5` | Crore. Matches overlapping bands, not midpoints |
| `q` | `q=whitefield` | Substring search |
| `sort` | `sort=price_asc` | `name`, `newest`, `price_asc`, `price_desc`, `size` |

`/api/rentals` and `/api/rentals.geojson`:

| Param | Example | Notes |
| --- | --- | --- |
| `bhk` | `bhk=2,3` | Bedroom counts |
| `zone` | `zone=East` | |
| `type` | `type=Apartment` | Apartment, Studio |
| `furnishing` | `furnishing=Fully furnished` | |
| `minRent` / `maxRent` | `maxRent=40000` | Rupees per month |
| `pets` | `pets=true` | Only listings that allow pets |
| `q` | `q=koramangala` | Substring search |
| `sort` | `sort=rent_asc` | `rent_asc`, `rent_desc`, `rating`, `size`, `name` |

```bash
curl 'http://localhost:4000/api/rentals?bhk=2&maxRent=35000&sort=rent_asc'
curl 'http://localhost:4000/api/roads.geojson?category=ring'
```

## Features

### Road overlays

Four ring roads are drawn with a translucent halo so they stay legible over busy tiles,
each with a hover tooltip explaining what it is and its current status:

| Road | Status | Drawn as |
| --- | --- | --- |
| **ORR** — Outer Ring Road | operational | solid violet |
| **NICE Road** — peripheral expressway | operational | solid cyan |
| **PRR** — Peripheral Ring Road | proposed | dashed pink |
| **STRR** — Satellite Town Ring Road (NH-948A) | partly open | dashed green |

Twelve arterial corridors (Hosur Road, Bellary Road, Old Madras Road, Sarjapur Road,
Whitefield Road, Bannerghatta Road, Kanakapura Road, Mysore Road, Tumkur Road, Hennur
Road, Old Airport Road, Magadi Road) are available as a second, thinner layer. Rings are
on by default and arterials off; both are toggled from the map legend.

### Your location and distances

The **Locate me** button asks the browser for your position. Once granted:

- a blue dot with an accuracy ring marks where you are,
- every result card gains a distance chip,
- the detail panel shows the distance in full,
- map popups include it too.

Distances are **straight-line (great-circle)**, not driving distance — in Bengaluru traffic
the difference matters, so treat them as a rough sort key rather than a commute estimate.

Geolocation needs a secure context, so it works on `localhost` and over HTTPS but not on a
plain `http://` deployment. Denial is handled gracefully: the app just carries on without
distances and says why.

### Rent mode

Rent mode replaces the dot markers with Airbnb-style price pills (`₹45K`), swaps in
rent-specific filters (bedrooms, furnishing, zone, type, rent ceiling, pets), and changes
the results list to photo cards. Hovering a card highlights its pin and vice versa.
Clicking one opens a side panel with a photo gallery (arrows, counter, thumbnail strip),
the full specification grid, amenities and the description.

### Shareable URLs

Filter state, search text, mode and the open property all round-trip through the query
string, so any view can be linked:

```
/?builder=prestige&zone=East&project=prestige-park-grove
/?mode=rent&bhk=2&maxRent=35000&home=hsr-2bhk
```

## About the data

Three data sets, three different caveats. `npm run validate` checks all of them.

**Sale projects — indicative.** Compiled from publicly announced launches. Coordinates are
locality-level approximations, price and size bands are ballpark rather than quotes, and
`rera` is `null` on every record rather than filled with an unverified number. Do not make
a purchase decision from it.

**Rentals — sample data, not real listings.** Every rental in `rentals.json` was generated
for this demo. The homes, rents, availability, ratings and photos are illustrative. The
photos are deterministic placeholders from [Lorem Picsum](https://picsum.photos), which is
why they are random images rather than interiors — real inventory would carry its own
`images` array, and `lib/rentals.js` already prefers one when present. The UI labels this
in the legend and in every detail panel. **Do not contact anyone or transfer money on the
basis of anything here.**

**Roads — hand-traced approximations.** The paths run through known junctions but are not
survey or cadastral data. The PRR especially is a proposed road whose alignment has shifted
repeatedly and whose land acquisition is incomplete.

### Adding or editing data

Edit the file under `server/data/` and restart (or use `npm run dev`).

A sale project:

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

A rental. Add an `images` array of `{ url, thumb }` objects to replace the placeholders:

```jsonc
{
  "id": "kor-2bhk",
  "title": "Bright 2 BHK off 5th Block",
  "locality": "Koramangala", "zone": "South East",
  "lat": 12.9352, "lng": 77.6245,
  "rentPerMonth": 55000, "deposit": 550000, "depositMonths": 10,
  "maintenancePerMonth": 2900,
  "bhk": 2, "propertyType": "Apartment", "furnishing": "Semi-furnished",
  "areaSqft": 1150, "floor": "3 of 5", "facing": "East",
  "availableFrom": "2026-10-01", "petsAllowed": true,
  "preferredTenants": "Family or bachelors",
  "rating": 4.6, "reviews": 38,
  "amenities": ["Lift", "Power backup"],
  "description": "One or two sentences.",
  "imageCount": 5
}
```

A road is `{ id, name, shortName, category, status, color, dashed, weight, note, path }`,
where `category` is `ring` or `radial` and `path` is an array of `[lat, lng]` waypoints.

Adding a builder means adding an entry to `builders.json` with an `id`, `name`,
`shortName`, `color` and `website`. Filter chips, the legend and the stats bar all build
themselves from the data, so no frontend change is needed.

## Notes

Tiles are keyless OpenStreetMap raster tiles. OSM's
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) covers
development and light traffic; for anything public-facing, sign up with a tile provider and
swap the URL and attribution in the `L.tileLayer` call in `web/js/mapview.js`.

The frontend is plain ES modules with no build step — Leaflet is the only dependency, from
a CDN.
