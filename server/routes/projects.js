import { Router } from 'express';
import { store } from '../lib/store.js';

export const router = Router();

/** `?builder=godrej,prestige` and `?builder=godrej&builder=prestige` both work. */
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
    builders: list(query.builder),
    zones: list(query.zone),
    types: list(query.type),
    statuses: list(query.status),
    configurations: list(query.config),
    minPriceCr: num(query.minPrice),
    maxPriceCr: num(query.maxPrice),
    q: query.q,
  };
}

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  price_asc: (a, b) => a.priceMinCr - b.priceMinCr,
  price_desc: (a, b) => b.priceMaxCr - a.priceMaxCr,
  size: (a, b) => (b.landAcres || 0) - (a.landAcres || 0),
  newest: (a, b) => (b.launchYear || 0) - (a.launchYear || 0) || a.name.localeCompare(b.name),
};

router.get('/projects', (req, res) => {
  const filters = filtersFrom(req.query);
  const results = store.query(filters);
  const sort = SORTS[req.query.sort] || SORTS.name;
  results.sort(sort);

  res.json({
    count: results.length,
    total: store.projects.length,
    filters,
    meta: store.meta,
    projects: results.map(({ searchBlob, ...p }) => p),
  });
});

router.get('/projects.geojson', (req, res) => {
  res.json(store.toGeoJSON(store.query(filtersFrom(req.query))));
});

router.get('/projects/:id', (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'not_found', id: req.params.id });
  const { searchBlob, ...rest } = project;
  res.json(rest);
});

router.get('/builders', (req, res) => {
  res.json({ builders: store.facets().builders });
});

router.get('/facets', (req, res) => {
  res.json(store.facets());
});

router.get('/stats', (req, res) => {
  res.json(store.stats());
});
