import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DOCS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'docs');

const DOC_TYPES = {
  '.pdf': 'PDF',
  '.jpg': 'Image', '.jpeg': 'Image', '.png': 'Image', '.webp': 'Image',
  '.mp4': 'Video', '.webm': 'Video', '.mov': 'Video',
};

const humanSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Files dropped in web/docs/<project-id>/ show up on that project without a
 * JSON edit. Scanned once at boot, so a new file needs a server restart.
 */
function loadDocuments() {
  const byProject = new Map();
  let dirs;
  try {
    dirs = fs.readdirSync(DOCS_DIR, { withFileTypes: true });
  } catch {
    return byProject;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const files = fs.readdirSync(path.join(DOCS_DIR, dir.name), { withFileTypes: true });
    const docs = files
      .filter((f) => f.isFile() && !f.name.startsWith('.') && !f.name.startsWith('_'))
      .filter((f) => DOC_TYPES[path.extname(f.name).toLowerCase()])
      .map((f) => {
        const bytes = fs.statSync(path.join(DOCS_DIR, dir.name, f.name)).size;
        return {
          name: f.name,
          type: DOC_TYPES[path.extname(f.name).toLowerCase()],
          bytes,
          size: humanSize(bytes),
          url: `/docs/${encodeURIComponent(dir.name)}/${encodeURIComponent(f.name)}`,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    if (docs.length) byProject.set(dir.name, docs);
  }
  return byProject;
}

const KIADB_CATCHMENT_KM = 10;
const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Straight-line distance in km. */
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/**
 * In-memory store backed by the JSON files in server/data.
 * Swapping this for a real database later means reimplementing load() and the
 * query helpers below - nothing outside this module reads the JSON directly.
 */
class Store {
  constructor() {
    this.load();
  }

  load() {
    const builderFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'builders.json'), 'utf8'));
    const projectFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'projects.json'), 'utf8'));
    const kiadbFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'kiadb.json'), 'utf8'));

    this.meta = projectFile.meta;
    this.kiadbParks = kiadbFile.parks;
    const documents = loadDocuments();
    this.builders = builderFile.builders;
    this.buildersById = new Map(this.builders.map((b) => [b.id, b]));

    this.projects = projectFile.projects.map((p) => {
      const builder = this.buildersById.get(p.builderId);
      if (!builder) throw new Error(`Project ${p.id} references unknown builder ${p.builderId}`);
      const nearestKiadb = this.nearestPark(p);
      return {
        ...p,
        nearestKiadb,
        documents: documents.get(p.id) || [],
        builder: builder.name,
        builderShortName: builder.shortName,
        builderColor: builder.color,
        builderWebsite: builder.website,
        // Denormalised for cheap substring search.
        searchBlob: [p.name, p.locality, p.corridor, p.zone, builder.name, p.propertyType, p.status,
          nearestKiadb?.name, nearestKiadb?.sector, ...(p.configurations || [])]
          .join(' ')
          .toLowerCase(),
      };
    });

    this.loadedAt = new Date().toISOString();
    return this;
  }

  /** Closest KIADB industrial area, so a listing can be read against the
   *  employment cluster it is actually selling proximity to. Null past the
   *  catchment radius - a park 15 km away is not a selling point. */
  nearestPark(p, maxKm = KIADB_CATCHMENT_KM) {
    let best = null;
    for (const park of this.kiadbParks) {
      const km = haversineKm(p, park);
      if (km > maxKm) continue;
      if (!best || km < best.distanceKm) best = { ...park, distanceKm: Math.round(km * 10) / 10 };
    }
    return best;
  }

  getProject(id) {
    return this.projects.find((p) => p.id === id) || null;
  }

  /**
   * @param {object} f
   * @param {string[]} [f.builders]   builder ids
   * @param {string[]} [f.zones]
   * @param {string[]} [f.types]      property types
   * @param {string[]} [f.statuses]
   * @param {string[]} [f.configurations]
   * @param {number}   [f.minPriceCr] keep projects whose band reaches at least this
   * @param {number}   [f.maxPriceCr] keep projects whose band starts at or below this
   * @param {string}   [f.q]          free-text search
   */
  query(f = {}) {
    const q = (f.q || '').trim().toLowerCase();
    return this.projects.filter((p) => {
      if (f.builders?.length && !f.builders.includes(p.builderId)) return false;
      if (f.zones?.length && !f.zones.includes(p.zone)) return false;
      if (f.types?.length && !f.types.includes(p.propertyType)) return false;
      if (f.statuses?.length && !f.statuses.includes(p.status)) return false;
      if (f.configurations?.length && !f.configurations.some((c) => p.configurations.includes(c))) return false;
      if (f.kiadb?.length && !f.kiadb.includes(p.nearestKiadb?.id)) return false;
      // Price bands overlap-match: a 1.2-2.6 Cr project survives a "max 1.5 Cr" filter.
      if (f.minPriceCr != null && p.priceMaxCr < f.minPriceCr) return false;
      if (f.maxPriceCr != null && p.priceMinCr > f.maxPriceCr) return false;
      if (q && !p.searchBlob.includes(q)) return false;
      return true;
    });
  }

  /** Distinct values plus counts, for building filter controls on the client. */
  /**
   * Counts are contextual: each dimension is tallied over the results of every
   * OTHER active filter, ignoring its own. So picking a builder narrows the zone
   * counts, while the builder counts still show what each alternative would give.
   * Values that exist globally are kept at count 0 rather than vanishing.
   */
  facets(filters = {}) {
    const subsetFor = (ownKey) => {
      const f = { ...filters };
      delete f[ownKey];
      return this.query(f);
    };

    const valuesOf = (p, field) => (Array.isArray(p[field]) ? p[field] : [p[field]]);

    const dimension = (field, ownKey) => {
      const counts = new Map();
      for (const p of subsetFor(ownKey)) {
        for (const v of valuesOf(p, field)) if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
      }
      const all = new Set();
      for (const p of this.projects) for (const v of valuesOf(p, field)) if (v != null) all.add(v);
      return [...all]
        .map((value) => ({ value, count: counts.get(value) || 0 }))
        .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
    };

    const builderRows = subsetFor('builders');
    const kiadbRows = subsetFor('kiadb');

    // Price bounds stay global so the budget slider's range does not jump around.
    const prices = this.projects.flatMap((p) => [p.priceMinCr, p.priceMaxCr]).filter((n) => typeof n === 'number');

    return {
      builders: this.builders.map((b) => ({
        ...b,
        count: builderRows.filter((p) => p.builderId === b.id).length,
      })),
      zones: dimension('zone', 'zones'),
      corridors: dimension('corridor', null),
      propertyTypes: dimension('propertyType', 'types'),
      statuses: dimension('status', 'statuses'),
      configurations: dimension('configurations', 'configurations'),
      kiadbParks: this.kiadbParks
        .filter((park) => this.projects.some((p) => p.nearestKiadb?.id === park.id))
        .map((park) => ({
          value: park.id,
          label: park.name.replace(/^KIADB (Industrial Area, )?/, ''),
          sector: park.sector,
          count: kiadbRows.filter((p) => p.nearestKiadb?.id === park.id).length,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      priceCr: { min: Math.min(...prices), max: Math.max(...prices) },
      total: this.projects.length,
      matching: this.query(filters).length,
    };
  }


  stats() {
    const byBuilder = this.builders.map((b) => {
      const rows = this.projects.filter((p) => p.builderId === b.id);
      return {
        builderId: b.id,
        builder: b.name,
        color: b.color,
        projects: rows.length,
        units: rows.reduce((s, p) => s + (p.totalUnits || 0), 0),
        acres: rows.reduce((s, p) => s + (p.landAcres || 0), 0),
      };
    });

    const byZone = {};
    for (const p of this.projects) byZone[p.zone] = (byZone[p.zone] || 0) + 1;

    return {
      totalProjects: this.projects.length,
      totalUnits: this.projects.reduce((s, p) => s + (p.totalUnits || 0), 0),
      totalAcres: this.projects.reduce((s, p) => s + (p.landAcres || 0), 0),
      byBuilder,
      byZone: Object.entries(byZone)
        .map(([zone, count]) => ({ zone, count }))
        .sort((a, b) => b.count - a.count),
      meta: this.meta,
      loadedAt: this.loadedAt,
    };
  }

  /** GeoJSON FeatureCollection - drop-in for Leaflet/Mapbox layers. */
  toGeoJSON(projects = this.projects) {
    return {
      type: 'FeatureCollection',
      features: projects.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { ...p, searchBlob: undefined },
      })),
    };
  }
}

export const store = new Store();
