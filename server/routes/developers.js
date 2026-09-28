import { Router } from 'express';
import { developerStore, stripBlob } from '../lib/developers.js';

export const router = Router();

router.get('/developers', (req, res) => {
  const results = developerStore.query({ q: req.query.q });
  const full = req.query.full === 'true';

  res.json({
    count: results.length,
    total: developerStore.developers.length,
    meta: developerStore.meta,
    developers: full ? results.map(stripBlob) : developerStore.summaries(results),
  });
});

router.get('/developers/:id', (req, res) => {
  const developer = developerStore.byId(req.params.id);
  if (!developer) return res.status(404).json({ error: 'not_found' });
  res.json({ meta: developerStore.meta, developer: stripBlob(developer) });
});
