/** Sanity-checks the JSON data set. Run with `npm run validate`. */
import { store } from './store.js';

const BLR = { latMin: 12.6, latMax: 13.5, lngMin: 77.2, lngMax: 78.1 };
const REQUIRED = ['id', 'name', 'builderId', 'locality', 'zone', 'lat', 'lng', 'propertyType', 'status'];

const errors = [];
const warnings = [];
const seen = new Set();

for (const p of store.projects) {
  const where = p.id || p.name || '(unnamed)';
  for (const key of REQUIRED) {
    if (p[key] == null || p[key] === '') errors.push(`${where}: missing "${key}"`);
  }
  if (seen.has(p.id)) errors.push(`${where}: duplicate id`);
  seen.add(p.id);

  if (p.lat < BLR.latMin || p.lat > BLR.latMax || p.lng < BLR.lngMin || p.lng > BLR.lngMax) {
    errors.push(`${where}: coordinates ${p.lat},${p.lng} fall outside the Bengaluru bounding box`);
  }
  if (p.priceMinCr != null && p.priceMaxCr != null && p.priceMinCr > p.priceMaxCr) {
    errors.push(`${where}: priceMinCr > priceMaxCr`);
  }
  if (p.sizeMinSqft != null && p.sizeMaxSqft != null && p.sizeMinSqft > p.sizeMaxSqft) {
    errors.push(`${where}: sizeMinSqft > sizeMaxSqft`);
  }
  if (!p.configurations?.length) warnings.push(`${where}: no configurations listed`);
  if (!p.rera) warnings.push(`${where}: no RERA number recorded`);
}

for (const e of errors) console.error(`ERROR  ${e}`);
for (const w of warnings) console.warn(`warn   ${w}`);
console.log(`\n${store.projects.length} projects, ${store.builders.length} builders, ${errors.length} errors, ${warnings.length} warnings.`);
process.exit(errors.length ? 1 : 0);
