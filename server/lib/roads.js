import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'roads.json');

class RoadStore {
  constructor() {
    const file = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    this.meta = file.meta;
    this.roads = file.roads;
  }

  byCategory(category) {
    return category ? this.roads.filter((r) => r.category === category) : this.roads;
  }

  /**
   * GeoJSON LineStrings. Note the coordinate flip: the source data stores
   * [lat, lng] pairs (Leaflet's order) but GeoJSON demands [lng, lat].
   */
  toGeoJSON(roads = this.roads) {
    return {
      type: 'FeatureCollection',
      features: roads.map((r) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: r.path.map(([lat, lng]) => [lng, lat]) },
        properties: {
          id: r.id,
          name: r.name,
          shortName: r.shortName,
          category: r.category,
          status: r.status,
          color: r.color,
          dashed: r.dashed,
          weight: r.weight,
          note: r.note,
        },
      })),
    };
  }
}

export const roadStore = new RoadStore();
