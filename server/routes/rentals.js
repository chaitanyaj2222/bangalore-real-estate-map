import { Router } from 'express';
import { rentalStore } from '../lib/rentals.js';
import { roadStore } from '../lib/roads.js';

export const router = Router();

function list(value) {
  if (value == null) return undefined;
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function num(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function filtersFrom(query) {
  return {
    bhk: list(query.bhk)?.map(Number).filter(Number.isFinite),
    zones: list(query.zone),
    types: list(query.type),
    furnishing: list(query.furnishing),
    minRent: num(query.minRent),
    maxRent: num(query.maxRent),
    pets: query.pets === 'true' ? true : undefined,
    q: query.q,
  };
}

const SORTS = {
  rent_asc: (a, b) => a.rentPerMonth - b.rentPerMonth,
  rent_desc: (a, b) => b.rentPerMonth - a.rentPerMonth,
  rating: (a, b) => b.rating - a.rating,
  size: (a, b) => b.areaSqft - a.areaSqft,
  name: (a, b) => a.title.localeCompare(b.title),
};

router.get('/rentals', (req, res) => {
  const filters = filtersFrom(req.query);
  const results = rentalStore.query(filters);
  results.sort(SORTS[req.query.sort] || SORTS.rent_asc);

  res.json({
    count: results.length,
    total: rentalStore.rentals.length,
    filters,
    meta: rentalStore.meta,
    rentals: results.map(({ searchBlob, ...r }) => r),
  });
});

router.get('/rentals.geojson', (req, res) => {
  res.json(rentalStore.toGeoJSON(rentalStore.query(filtersFrom(req.query))));
});

router.get('/rentals/facets', (req, res) => {
  res.json(rentalStore.facets());
});

router.get('/rentals/:id', (req, res) => {
  const rental = rentalStore.get(req.params.id);
  if (!rental) return res.status(404).json({ error: 'not_found', id: req.params.id });
  const { searchBlob, ...rest } = rental;
  res.json(rest);
});

router.get('/roads', (req, res) => {
  const roads = roadStore.byCategory(req.query.category);
  res.json({ meta: roadStore.meta, count: roads.length, roads });
});

router.get('/roads.geojson', (req, res) => {
  res.json(roadStore.toGeoJSON(roadStore.byCategory(req.query.category)));
});
