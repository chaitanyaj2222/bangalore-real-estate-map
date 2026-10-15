import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'rentals.json');

/**
 * Placeholder photography. Real inventory would carry its own `images` array;
 * until then each listing gets a deterministic set of stand-in photos so the
 * gallery has something stable to show. Swap this out when real photos exist.
 */
function imagesFor(listing) {
  if (Array.isArray(listing.images) && listing.images.length) return listing.images;
  return Array.from({ length: listing.imageCount || 4 }, (_, i) => ({
    url: `https://picsum.photos/seed/${listing.id}-${i}/960/720`,
    thumb: `https://picsum.photos/seed/${listing.id}-${i}/320/240`,
    placeholder: true,
  }));
}

class RentalStore {
  constructor() {
    const file = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    this.meta = file.meta;
    this.rentals = file.rentals.map((r) => ({
      ...r,
      images: imagesFor(r),
      searchBlob: [r.title, r.locality, r.zone, r.propertyType, r.furnishing, `${r.bhk} BHK`]
        .join(' ')
        .toLowerCase(),
    }));
    this.loadedAt = new Date().toISOString();
  }

  get(id) {
    return this.rentals.find((r) => r.id === id) || null;
  }

  /**
   * @param {object} f
   * @param {number[]} [f.bhk]
   * @param {string[]} [f.zones]
   * @param {string[]} [f.types]
   * @param {string[]} [f.furnishing]
   * @param {number}   [f.minRent]
   * @param {number}   [f.maxRent]
   * @param {boolean}  [f.pets]
   * @param {string}   [f.q]
   */
  query(f = {}) {
    const q = (f.q || '').trim().toLowerCase();
    return this.rentals.filter((r) => {
      if (f.bhk?.length && !f.bhk.includes(r.bhk)) return false;
      if (f.zones?.length && !f.zones.includes(r.zone)) return false;
      if (f.types?.length && !f.types.includes(r.propertyType)) return false;
      if (f.furnishing?.length && !f.furnishing.includes(r.furnishing)) return false;
      if (f.minRent != null && r.rentPerMonth < f.minRent) return false;
      if (f.maxRent != null && r.rentPerMonth > f.maxRent) return false;
      if (f.pets === true && !r.petsAllowed) return false;
      if (q && !r.searchBlob.includes(q)) return false;
      return true;
    });
  }

  facets(filters = {}) {
    const subsetFor = (ownKey) => {
      const f = { ...filters };
      delete f[ownKey];
      return this.query(f);
    };

    const tally = (key, ownKey) => {
      const counts = new Map();
      for (const r of subsetFor(ownKey)) counts.set(r[key], (counts.get(r[key]) || 0) + 1);
      const all = new Set();
      for (const r of this.rentals) all.add(r[key]);
      return [...all]
        .map((value) => ({ value, count: counts.get(value) || 0 }))
        .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
    };

    const bhkSubset = subsetFor('bhk');
    const rents = this.rentals.map((r) => r.rentPerMonth);
    return {
      bhk: [...new Set(this.rentals.map((r) => r.bhk))]
        .sort((a, b) => a - b)
        .map((value) => ({ value, count: bhkSubset.filter((r) => r.bhk === value).length })),
      zones: tally('zone', 'zones'),
      propertyTypes: tally('propertyType', 'types'),
      furnishing: tally('furnishing', 'furnishing'),
      rent: { min: Math.min(...rents), max: Math.max(...rents) },
      petsAllowed: subsetFor('pets').filter((r) => r.petsAllowed).length,
      total: this.rentals.length,
      matching: this.query(filters).length,
      meta: this.meta,
    };
  }

  toGeoJSON(rentals = this.rentals) {
    return {
      type: 'FeatureCollection',
      features: rentals.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: { ...r, searchBlob: undefined },
      })),
    };
  }
}

export const rentalStore = new RentalStore();
