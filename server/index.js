import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { router as apiRouter } from './routes/projects.js';
import { router as rentalRouter } from './routes/rentals.js';
import { router as developerRouter } from './routes/developers.js';
import { store } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT) || 4000;

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  // Open CORS: the API is public read-only data and may be embedded elsewhere.
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, projects: store.projects.length, loadedAt: store.loadedAt });
});

app.use('/api', apiRouter);
app.use('/api', rentalRouter);
app.use('/api', developerRouter);
app.use(express.static(WEB_DIR, { extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  res.status(404).sendFile(path.join(WEB_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Bangalore Real Estate Map -> http://localhost:${PORT}  (${store.projects.length} projects)`);
});
