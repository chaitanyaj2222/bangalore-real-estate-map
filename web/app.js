/* Bangalore Real Estate Map - frontend. Talks to the Express API in /server. */

const BLR = { center: [12.99, 77.66], zoom: 11 };

const state = {
  builder: new Set(),
  zone: new Set(),
  type: new Set(),
  status: new Set(),
  config: new Set(),
  maxPrice: null,
  q: '',
  sort: 'name',
};

let facets = null;
let projects = [];
let selectedId = null;
let pendingProjectId = null;
const markers = new Map();

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return node;
};

/* ---------- formatting ---------- */

const crore = (n) => (n >= 1 ? `${Number(n.toFixed(2))} Cr` : `${Math.round(n * 100)} L`);
const priceBand = (p) =>
  p.priceMinCr == null ? 'Price on request'
  : p.priceMinCr === p.priceMaxCr ? `₹${crore(p.priceMinCr)}`
  : `₹${crore(p.priceMinCr)} – ${crore(p.priceMaxCr)}`;
const sizeBand = (p) =>
  p.sizeMinSqft == null ? '—'
  : `${p.sizeMinSqft.toLocaleString('en-IN')} – ${p.sizeMaxSqft.toLocaleString('en-IN')} sq ft`;
const nfmt = (n) => (n == null ? '—' : n.toLocaleString('en-IN'));

/* ---------- map ---------- */

const map = L.map('map', { zoomControl: false, attributionControl: true })
  .setView(BLR.center, BLR.zoom);

// Keyless raster tiles. CARTO / Stadia / Mapbox all want an API key now; if you
// sign up for one, swap the url + attribution here and nothing else changes.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);
const markerLayer = L.layerGroup().addTo(map);

/** Pin diameter scales with unit count so townships read bigger than boutique blocks. */
function pinSize(units) {
  if (!units) return 13;
  return Math.round(Math.min(26, Math.max(12, 10 + Math.sqrt(units) / 4.2)));
}

function buildMarkers(rows) {
  markerLayer.clearLayers();
  markers.clear();

  for (const p of rows) {
    const d = pinSize(p.totalUnits);
    const marker = L.marker([p.lat, p.lng], {
      title: p.name,
      riseOnHover: true,
      icon: L.divIcon({
        className: '',
        html: `<div class="pin" data-id="${p.id}" style="width:${d}px;height:${d}px;background:${p.builderColor}"></div>`,
        iconSize: [d, d],
        iconAnchor: [d / 2, d / 2],
      }),
    });

    marker.bindPopup(
      `<b>${escapeHtml(p.name)}</b>${escapeHtml(p.builder)} · ${escapeHtml(p.locality)}<br>${escapeHtml(priceBand(p))}`,
      { closeButton: false, offset: [0, -4] }
    );
    marker.on('mouseover', () => marker.openPopup());
    marker.on('mouseout', () => marker.closePopup());
    marker.on('click', () => select(p.id, { pan: false }));

    marker.addTo(markerLayer);
    markers.set(p.id, marker);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- data ---------- */

function queryString() {
  const qs = new URLSearchParams();
  for (const key of ['builder', 'zone', 'type', 'status', 'config']) {
    if (state[key].size) qs.set(key, [...state[key]].join(','));
  }
  if (state.maxPrice != null) qs.set('maxPrice', state.maxPrice);
  if (state.q) qs.set('q', state.q);
  if (state.sort !== 'name') qs.set('sort', state.sort);
  return qs;
}

/** The URL carries the filters plus the open project, so any view is shareable. */
function syncUrl() {
  const qs = queryString();
  if (selectedId) qs.set('project', selectedId);
  history.replaceState(null, '', qs.toString() ? `?${qs}` : location.pathname);
}

async function refresh() {
  const qs = queryString();
  syncUrl();

  const res = await fetch(`/api/projects?${qs}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();

  projects = data.projects;
  renderResults(data);
  buildMarkers(projects);
  renderChipStates();

  if (selectedId && !projects.some((p) => p.id === selectedId)) closeDetail();
  else if (selectedId) highlightPin(selectedId);

  // Reframe so filtered results are never left off-screen, but never yank the
  // map away from a project the user is reading about.
  if (!selectedId) fitToData();
}

function readUrl() {
  const qs = new URLSearchParams(location.search);
  for (const key of ['builder', 'zone', 'type', 'status', 'config']) {
    const raw = qs.get(key);
    if (raw) state[key] = new Set(raw.split(',').filter(Boolean));
  }
  if (qs.get('maxPrice')) state.maxPrice = Number(qs.get('maxPrice'));
  if (qs.get('q')) state.q = qs.get('q');
  if (qs.get('sort')) state.sort = qs.get('sort');
  if (qs.get('project')) pendingProjectId = qs.get('project');
}

/* ---------- filters ---------- */

function toggle(key, value) {
  state[key].has(value) ? state[key].delete(value) : state[key].add(value);
  refresh();
}

function chip(key, value, label, count, color) {
  return el(
    'button',
    {
      type: 'button',
      class: 'chip',
      'data-key': key,
      'data-value': value,
      'aria-pressed': String(state[key].has(value)),
      onclick: () => toggle(key, value),
    },
    color ? el('span', { class: 'dot', style: `background:${color}` }) : null,
    label,
    count != null ? el('span', { class: 'n', text: count }) : null
  );
}

function group(title, children) {
  return el('div', { class: 'fgroup' }, el('h3', { text: title }), el('div', { class: 'chips' }, children));
}

function renderFilters() {
  const wrap = $('#filterGroups');
  wrap.textContent = '';

  wrap.append(
    group('Builder', facets.builders.map((b) => chip('builder', b.id, b.shortName, b.count, b.color))),
    group('Zone', facets.zones.map((z) => chip('zone', z.value, z.value, z.count))),
    group('Property type', facets.propertyTypes.map((t) => chip('type', t.value, t.value, t.count))),
    group('Status', facets.statuses.map((s) => chip('status', s.value, s.value, s.count))),
    group('Configuration', facets.configurations.map((c) => chip('config', c.value, c.value, c.count)))
  );

  const ceiling = Math.ceil(facets.priceCr.max);
  const slider = el('input', {
    type: 'range',
    min: '0.5',
    max: String(ceiling),
    step: '0.25',
    value: String(state.maxPrice ?? ceiling),
    'aria-label': 'Maximum price in crore',
  });
  const out = el('output');
  const syncOut = () => {
    out.textContent = Number(slider.value) >= ceiling ? 'Any' : `up to ₹${crore(Number(slider.value))}`;
  };
  slider.addEventListener('input', syncOut);
  slider.addEventListener('change', () => {
    state.maxPrice = Number(slider.value) >= ceiling ? null : Number(slider.value);
    refresh();
  });
  syncOut();

  wrap.append(el('div', { class: 'fgroup' }, el('h3', { text: 'Budget' }), el('div', { class: 'price-row' }, slider, out)));
}

function renderChipStates() {
  for (const node of document.querySelectorAll('.chip')) {
    node.setAttribute('aria-pressed', String(state[node.dataset.key].has(node.dataset.value)));
  }
}

/* ---------- results list ---------- */

function renderResults(data) {
  $('#resultCount').textContent =
    data.count === data.total ? `${data.total} projects` : `${data.count} of ${data.total} projects`;

  const list = $('#results');
  list.textContent = '';

  if (!data.projects.length) {
    list.append(el('li', { class: 'empty' }, 'No projects match these filters.'));
    return;
  }

  for (const p of data.projects) {
    const card = el(
      'li',
      {
        class: 'card',
        style: `--card-color:${p.builderColor}`,
        'data-id': p.id,
        tabindex: '0',
        role: 'button',
        'aria-current': String(selectedId === p.id),
        onclick: () => select(p.id),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.id); }
        },
      },
      el('div', { class: 'card-top' }, el('h3', { text: p.name }), el('span', { class: 'price', text: priceBand(p) })),
      el('p', { class: 'loc', text: `${p.locality} · ${p.zone}` }),
      el(
        'div',
        { class: 'tags' },
        el('span', { class: 'tag builder', style: `background:${p.builderColor}`, text: p.builderShortName }),
        el('span', { class: 'tag', text: p.propertyType }),
        el('span', { class: 'tag', text: p.status }),
        p.possession ? el('span', { class: 'tag', text: `Poss. ${p.possession}` }) : null
      )
    );
    list.append(card);
  }
}

/* ---------- selection + detail ---------- */

function highlightPin(id) {
  for (const node of document.querySelectorAll('.pin')) {
    node.classList.toggle('is-active', node.dataset.id === id);
  }
}

function select(id, { pan = true } = {}) {
  const p = projects.find((x) => x.id === id);
  if (!p) return;

  selectedId = id;
  for (const card of document.querySelectorAll('.card')) {
    card.setAttribute('aria-current', String(card.dataset.id === id));
  }
  document.querySelector(`.card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });

  highlightPin(id);
  if (pan) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
  if (window.matchMedia('(max-width: 720px)').matches) document.body.classList.remove('show-map');

  renderDetail(p);
  syncUrl();
}

function kv(label, value) {
  return el('div', {}, el('dt', { text: label }), el('dd', { text: value }));
}

function renderDetail(p) {
  const body = $('#detailBody');
  body.textContent = '';

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

  body.append(
    el('span', { class: 'eyebrow', style: `background:${p.builderColor}`, text: p.builder }),
    el('h2', { text: p.name }),
    el('p', { class: 'sub', text: `${p.locality} · ${p.corridor} · ${p.zone} Bengaluru` }),
    el(
      'dl',
      { class: 'kv' },
      kv('Price band', priceBand(p)),
      kv('Sizes', sizeBand(p)),
      kv('Configurations', (p.configurations || []).join(', ') || '—'),
      kv('Type', p.propertyType),
      kv('Status', p.status),
      kv('Possession', p.possession || '—'),
      kv('Land area', p.landAcres ? `${p.landAcres} acres` : '—'),
      kv('Units', nfmt(p.totalUnits)),
      kv('Launched', p.launchYear || '—'),
      kv('RERA', p.rera || 'Not recorded')
    )
  );

  if (p.highlights?.length) {
    body.append(
      el('h4', { text: 'Highlights' }),
      el('ul', { class: 'bullets' }, p.highlights.map((h) => el('li', { text: h })))
    );
  }

  body.append(
    el(
      'div',
      { class: 'actions' },
      el('a', { href: mapsUrl, target: '_blank', rel: 'noopener', text: 'Open in Google Maps' }),
      p.builderWebsite ? el('a', { href: p.builderWebsite, target: '_blank', rel: 'noopener', text: 'Builder site' }) : null,
      el('a', { href: `/api/projects/${p.id}`, target: '_blank', rel: 'noopener', text: 'View JSON' })
    ),
    el('p', {
      class: 'note',
      text: 'Location is a locality-level approximation and the price band is indicative, not a quote. Confirm RERA registration, pricing and possession with the developer.',
    })
  );

  $('#detail').hidden = false;
}

function closeDetail() {
  selectedId = null;
  $('#detail').hidden = true;
  highlightPin(null);
  for (const card of document.querySelectorAll('.card')) card.setAttribute('aria-current', 'false');
  syncUrl();
}

/* ---------- chrome ---------- */

function renderTopbarStats(stats) {
  const wrap = $('#topbarStats');
  wrap.textContent = '';
  const pills = [
    [nfmt(stats.totalProjects), 'Projects'],
    [nfmt(stats.totalUnits), 'Units'],
    [nfmt(Math.round(stats.totalAcres)), 'Acres'],
    [String(stats.byBuilder.length), 'Builders'],
  ];
  for (const [value, label] of pills) {
    wrap.append(el('div', { class: 'stat' }, el('b', { text: value }), el('span', { text: label })));
  }
}

function renderLegend() {
  const wrap = $('#legend');
  wrap.textContent = '';
  for (const b of facets.builders) {
    wrap.append(
      el('div', { class: 'row' }, el('span', { class: 'dot', style: `background:${b.color}` }), `${b.shortName} (${b.count})`)
    );
  }
  wrap.append(el('div', { class: 'row', style: 'margin-top:7px;color:#8b939c' }, 'Pin size ≈ unit count'));
}

function wireEvents() {
  let timer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); refresh(); }, 180);
  });

  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; refresh(); });

  $('#resetFilters').addEventListener('click', () => {
    for (const key of ['builder', 'zone', 'type', 'status', 'config']) state[key].clear();
    state.maxPrice = null;
    state.q = '';
    $('#search').value = '';
    renderFilters();
    refresh();
  });

  $('#detailClose').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

  const toggleBtn = $('#mobileToggle');
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('show-map');
    const onMap = document.body.classList.contains('show-map');
    toggleBtn.textContent = onMap ? 'List' : 'Map';
    if (!onMap) return;
    // The map container was display:none until now, so Leaflet has stale dimensions.
    const active = selectedId && projects.find((p) => p.id === selectedId);
    if (active) {
      map.invalidateSize();
      map.setView([active.lat, active.lng], Math.max(map.getZoom(), 13));
    } else {
      fitToData();
    }
  });
}

/* ---------- boot ---------- */

async function init() {
  readUrl();
  $('#search').value = state.q;
  $('#sort').value = state.sort;

  const [facetRes, statsRes] = await Promise.all([fetch('/api/facets'), fetch('/api/stats')]);
  facets = await facetRes.json();
  const stats = await statsRes.json();

  $('#disclaimer').textContent = stats.meta.disclaimer;
  renderTopbarStats(stats);
  renderFilters();
  renderLegend();
  wireEvents();
  await refresh();

  fitToData();

  if (pendingProjectId) {
    const target = pendingProjectId;
    pendingProjectId = null;
    select(target);
  }
}

/** Frame the map to the data rather than a hardcoded zoom. */
function fitToData() {
  if (!projects.length) return;
  map.invalidateSize();
  map.fitBounds(L.latLngBounds(projects.map((p) => [p.lat, p.lng])), {
    padding: [48, 48],
    maxZoom: 13,
    animate: false,
  });
}

init().catch((err) => {
  console.error(err);
  $('#results').innerHTML = '<li class="empty">Could not load project data. Is the server running?</li>';
});
