import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

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

    this.meta = projectFile.meta;
    this.builders = builderFile.builders;
    this.buildersById = new Map(this.builders.map((b) => [b.id, b]));

    this.projects = projectFile.projects.map((p) => {
      const builder = this.buildersById.get(p.builderId);
      if (!builder) throw new Error(`Project ${p.id} references unknown builder ${p.builderId}`);
      return {
        ...p,
        builder: builder.name,
        builderShortName: builder.shortName,
        builderColor: builder.color,
        builderWebsite: builder.website,
        // Denormalised for cheap substring search.
        searchBlob: [p.name, p.locality, p.corridor, p.zone, builder.name, p.propertyType, p.status, ...(p.configurations || [])]
          .join(' ')
          .toLowerCase(),
      };
    });

    this.loadedAt = new Date().toISOString();
    return this;
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
      // Price bands overlap-match: a 1.2-2.6 Cr project survives a "max 1.5 Cr" filter.
      if (f.minPriceCr != null && p.priceMaxCr < f.minPriceCr) return false;
      if (f.maxPriceCr != null && p.priceMinCr > f.maxPriceCr) return false;
      if (q && !p.searchBlob.includes(q)) return false;
      return true;
    });
  }

  /** Distinct values plus counts, for building filter controls on the client. */
  facets() {
    const tally = (key) => {
      const counts = new Map();
      for (const p of this.projects) {
        const values = Array.isArray(p[key]) ? p[key] : [p[key]];
        for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
    };

    const prices = this.projects.flatMap((p) => [p.priceMinCr, p.priceMaxCr]).filter((n) => typeof n === 'number');

    return {
      builders: this.builders.map((b) => ({
        ...b,
        count: this.projects.filter((p) => p.builderId === b.id).length,
      })),
      zones: tally('zone'),
      corridors: tally('corridor'),
      propertyTypes: tally('propertyType'),
      statuses: tally('status'),
      configurations: tally('configurations'),
      priceCr: { min: Math.min(...prices), max: Math.max(...prices) },
      total: this.projects.length,
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
