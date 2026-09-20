/** Sanity-checks the JSON data sets. Run with `npm run validate`. */
import { store } from './store.js';
import { rentalStore } from './rentals.js';
import { roadStore } from './roads.js';

const BLR = { latMin: 12.6, latMax: 13.5, lngMin: 77.2, lngMax: 78.1 };

const errors = [];
const warnings = [];

const inBox = (lat, lng, box = BLR) =>
  lat >= box.latMin && lat <= box.latMax && lng >= box.lngMin && lng <= box.lngMax;

function checkRequired(obj, keys, label) {
  for (const key of keys) {
    if (obj[key] == null || obj[key] === '') errors.push(`${label}: missing "${key}"`);
  }
}

/* ---------- sale projects ---------- */

const projectIds = new Set();
for (const p of store.projects) {
  const where = `project ${p.id || p.name || '(unnamed)'}`;
  checkRequired(p, ['id', 'name', 'builderId', 'locality', 'zone', 'lat', 'lng', 'propertyType', 'status'], where);

  if (projectIds.has(p.id)) errors.push(`${where}: duplicate id`);
  projectIds.add(p.id);

  if (!inBox(p.lat, p.lng)) errors.push(`${where}: coordinates ${p.lat},${p.lng} fall outside the Bengaluru bounding box`);
  if (p.priceMinCr != null && p.priceMaxCr != null && p.priceMinCr > p.priceMaxCr) errors.push(`${where}: priceMinCr > priceMaxCr`);
  if (p.sizeMinSqft != null && p.sizeMaxSqft != null && p.sizeMinSqft > p.sizeMaxSqft) errors.push(`${where}: sizeMinSqft > sizeMaxSqft`);
  if (!p.configurations?.length) warnings.push(`${where}: no configurations listed`);
  if (!p.rera) warnings.push(`${where}: no RERA number recorded`);
}

/* ---------- rentals ---------- */

const rentalIds = new Set();
for (const r of rentalStore.rentals) {
  const where = `rental ${r.id || r.title || '(unnamed)'}`;
  checkRequired(r, ['id', 'title', 'locality', 'zone', 'lat', 'lng', 'rentPerMonth', 'bhk', 'propertyType'], where);

  if (rentalIds.has(r.id)) errors.push(`${where}: duplicate id`);
  rentalIds.add(r.id);

  if (!inBox(r.lat, r.lng)) errors.push(`${where}: coordinates ${r.lat},${r.lng} fall outside the Bengaluru bounding box`);
  if (!(r.rentPerMonth > 0)) errors.push(`${where}: rent must be positive`);
  if (!r.images?.length) errors.push(`${where}: no images`);
  if (r.deposit != null && r.deposit < r.rentPerMonth) warnings.push(`${where}: deposit is under one month's rent`);
  if (r.images?.every((i) => i.placeholder)) warnings.push(`${where}: all images are placeholders`);
}

/* ---------- roads ---------- */

const roadIds = new Set();
const REGION = { latMin: 12.2, latMax: 13.6, lngMin: 77.0, lngMax: 78.3 };

for (const road of roadStore.roads) {
  const where = `road ${road.id || road.name || '(unnamed)'}`;
  checkRequired(road, ['id', 'name', 'shortName', 'category', 'color', 'path'], where);

  if (roadIds.has(road.id)) errors.push(`${where}: duplicate id`);
  roadIds.add(road.id);

  if (!Array.isArray(road.path) || road.path.length < 2) {
    errors.push(`${where}: needs at least two waypoints`);
    continue;
  }
  const stray = road.path.find(([lat, lng]) => !inBox(lat, lng, REGION));
  if (stray) errors.push(`${where}: waypoint ${stray} is far outside the Bengaluru region`);

  // Closed rings should return to their starting point. NICE and the PRR are arcs, not loops.
  if (road.category === 'ring' && !['nice', 'prr'].includes(road.id)) {
    const first = road.path[0];
    const last = road.path[road.path.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) warnings.push(`${where}: ring does not close`);
  }
}

/* ---------- report ---------- */

for (const e of errors) console.error(`ERROR  ${e}`);
for (const w of warnings) console.warn(`warn   ${w}`);
console.log(
  `\n${store.projects.length} projects, ${store.builders.length} builders, ` +
  `${rentalStore.rentals.length} rentals, ${roadStore.roads.length} roads: ` +
  `${errors.length} errors, ${warnings.length} warnings.`
);
process.exit(errors.length ? 1 : 0);
