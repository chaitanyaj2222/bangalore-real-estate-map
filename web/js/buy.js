/* Buy mode: upcoming sale projects. */

import { $, el, escapeHtml, nfmt, saleBand, sizeBand, haversineKm, formatKm } from './util.js';
import { getProjects, getProjectFacets } from './api.js';
import { map, markerLayer, fitTo, getUserLatLng, distanceChip } from './mapview.js';

export const state = {
  builder: new Set(), zone: new Set(), type: new Set(), status: new Set(), config: new Set(),
  kiadb: new Set(), maxPrice: null, sort: 'name',
};

let facets = null;
let rows = [];
let selectedId = null;
let onSelect = () => {};

export const getSelectedId = () => selectedId;
export const setOnSelect = (fn) => (onSelect = fn);

export async function loadFacets() {
  facets = await getProjectFacets();
  return facets;
}

export function queryString(q) {
  const qs = new URLSearchParams();
  for (const key of ['builder', 'zone', 'type', 'status', 'config', 'kiadb']) {
    if (state[key].size) qs.set(key, [...state[key]].join(','));
  }
  if (state.maxPrice != null) qs.set('maxPrice', state.maxPrice);
  if (q) qs.set('q', q);
  if (state.sort !== 'name') qs.set('sort', state.sort);
  return qs;
}

function withDistance(list) {
  const me = getUserLatLng();
  return list.map((p) => ({ ...p, distanceKm: me ? haversineKm(me, p) : null }));
}

/* ---------- markers ---------- */

function pinSize(units) {
  if (!units) return 13;
  return Math.round(Math.min(26, Math.max(12, 10 + Math.sqrt(units) / 4.2)));
}

function buildMarkers() {
  markerLayer.clearLayers();
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
    const dist = p.distanceKm != null ? `<br>${formatKm(p.distanceKm)} from you` : '';
    marker.bindPopup(
      `<b>${escapeHtml(p.name)}</b>${escapeHtml(p.builder)} · ${escapeHtml(p.locality)}<br>${escapeHtml(saleBand(p))}${dist}`,
      { closeButton: false, offset: [0, -4] }
    );
    marker.on('mouseover', () => marker.openPopup());
    marker.on('mouseout', () => marker.closePopup());
    marker.on('click', () => select(p.id, { pan: false }));
    marker.addTo(markerLayer);
  }
}

export function highlightPin(id) {
  for (const node of document.querySelectorAll('.pin')) node.classList.toggle('is-active', node.dataset.id === id);
}

/* ---------- filters ---------- */

function chip(key, value, label, count, color, refresh) {
  return el('button', {
    type: 'button', class: 'chip', 'data-key': key, 'data-value': value,
    'aria-pressed': String(state[key].has(value)),
    onclick: () => { state[key].has(value) ? state[key].delete(value) : state[key].add(value); refresh(); },
  },
    color ? el('span', { class: 'dot', style: `background:${color}` }) : null,
    label,
    count != null ? el('span', { class: 'n', text: count }) : null);
}

const group = (title, children) =>
  el('div', { class: 'fgroup' }, el('h3', { text: title }), el('div', { class: 'chips' }, children));

export function renderFilters(wrap, refresh) {
  wrap.textContent = '';
  wrap.append(
    group('Builder', facets.builders.map((b) => chip('builder', b.id, b.shortName, b.count, b.color, refresh))),
    group('Zone', facets.zones.map((z) => chip('zone', z.value, z.value, z.count, null, refresh))),
    group('Property type', facets.propertyTypes.map((t) => chip('type', t.value, t.value, t.count, null, refresh))),
    group('Status', facets.statuses.map((s) => chip('status', s.value, s.value, s.count, null, refresh))),
    group('Configuration', facets.configurations.map((c) => chip('config', c.value, c.value, c.count, null, refresh))),
    group('Near a KIADB area', facets.kiadbParks.map((k) => chip('kiadb', k.value, k.label, k.count, null, refresh)))
  );

  const ceiling = Math.ceil(facets.priceCr.max);
  const slider = el('input', { type: 'range', min: '0.5', max: String(ceiling), step: '0.25',
    value: String(state.maxPrice ?? ceiling), 'aria-label': 'Maximum price in crore' });
  const out = el('output');
  const sync = () => { out.textContent = Number(slider.value) >= ceiling ? 'Any' : `up to ₹${Number(slider.value).toFixed(2)} Cr`; };
  slider.addEventListener('input', sync);
  slider.addEventListener('change', () => {
    state.maxPrice = Number(slider.value) >= ceiling ? null : Number(slider.value);
    refresh();
  });
  sync();
  wrap.append(el('div', { class: 'fgroup' }, el('h3', { text: 'Budget' }), el('div', { class: 'price-row' }, slider, out)));
}

export function syncChips() {
  for (const node of document.querySelectorAll('.chip[data-key]')) {
    const set = state[node.dataset.key];
    if (set) node.setAttribute('aria-pressed', String(set.has(node.dataset.value)));
  }
}

export function resetFilters() {
  for (const key of ['builder', 'zone', 'type', 'status', 'config', 'kiadb']) state[key].clear();
  state.maxPrice = null;
}

/* ---------- results list ---------- */

export function renderResults(listEl, countEl, data) {
  countEl.textContent = data.count === data.total ? `${data.total} projects` : `${data.count} of ${data.total} projects`;
  listEl.textContent = '';

  if (!rows.length) {
    listEl.append(el('li', { class: 'empty' }, 'No projects match these filters.'));
    return;
  }

  for (const p of rows) {
    listEl.append(el('li', {
      class: 'card', style: `--card-color:${p.builderColor}`, 'data-id': p.id,
      tabindex: '0', role: 'button', 'aria-current': String(selectedId === p.id),
      onclick: () => select(p.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.id); } },
    },
      el('div', { class: 'card-top' }, el('h3', { text: p.name }), el('span', { class: 'price', text: saleBand(p) })),
      el('p', { class: 'loc', text: `${p.locality} · ${p.zone}` }),
      el('div', { class: 'tags' },
        el('span', { class: 'tag builder', style: `background:${p.builderColor}`, text: p.builderShortName }),
        el('span', { class: 'tag', text: p.propertyType }),
        el('span', { class: 'tag', text: p.status }),
        p.possession ? el('span', { class: 'tag', text: `Poss. ${p.possession}` }) : null,
        p.nearestKiadb ? el('span', { class: 'tag kiadb', text: `KIADB ${p.nearestKiadb.distanceKm} km` }) : null,
        distanceChip(p.distanceKm))
    ));
  }
}

/* ---------- detail ---------- */

const kv = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }));

function renderDetail(p, body) {
  body.textContent = '';
  body.append(
    el('span', { class: 'eyebrow', style: `background:${p.builderColor}`, text: p.builder }),
    el('h2', { text: p.name }),
    el('p', { class: 'sub', text: `${p.locality} · ${p.corridor} · ${p.zone} Bengaluru` }),
    p.distanceKm != null
      ? el('p', { class: 'dist-line', text: `${formatKm(p.distanceKm)} from your location, straight line` })
      : null,
    el('dl', { class: 'kv' },
      kv('Price band', saleBand(p)),
      kv('Sizes', sizeBand(p)),
      kv('Configurations', (p.configurations || []).join(', ') || '—'),
      kv('Type', p.propertyType),
      kv('Status', p.status),
      kv('Possession', p.possession || '—'),
      kv('Land area', p.landAcres ? `${p.landAcres} acres` : '—'),
      kv('Units', nfmt(p.totalUnits)),
      kv('Launched', p.launchYear || '—'),
      kv('RERA', p.rera || 'Not recorded'),
      p.pricePerSqft ? kv('Rate', `₹${nfmt(p.pricePerSqft)} / sq ft`) : null,
      kv('Nearest KIADB area', p.nearestKiadb
        ? `${p.nearestKiadb.locality} · ${p.nearestKiadb.distanceKm} km`
        : 'None within 10 km'))
  );

  if (p.highlights?.length) {
    body.append(el('h4', { text: 'Highlights' }), el('ul', { class: 'bullets' }, p.highlights.map((h) => el('li', { text: h }))));
  }

  if (p.plotMix?.length) {
    body.append(el('h4', { text: 'Plot mix' }), el('table', { class: 'mini-table' },
      el('tbody', {}, p.plotMix.map((m) => el('tr', {},
        el('td', { text: m.label }),
        el('td', { class: 'dim', text: m.metric }),
        el('td', { class: 'num', text: m.count })))),
      el('tfoot', {}, el('tr', {},
        el('td', { text: 'Total sites' }),
        el('td', {}),
        el('td', { class: 'num', text: p.plotMix.reduce((n, m) => n + m.count, 0) })))));
  }

  if (p.landUse?.length) {
    body.append(el('h4', { text: 'Land use' }), el('table', { class: 'mini-table' },
      el('tbody', {}, p.landUse.map((u) => el('tr', {},
        el('td', { text: u.use }),
        el('td', { class: 'dim', text: `${nfmt(u.areaSqm)} sq m` }),
        el('td', { class: 'num', text: `${u.pct}%` }))))));
  }

  if (p.documents?.length) {
    const media = p.documents.filter((d) => d.type !== 'PDF');
    const files = p.documents.filter((d) => d.type === 'PDF');

    for (const m of media) {
      body.append(el('h4', { text: m.type === 'Video' ? 'Walkthrough' : 'Gallery' }));
      body.append(m.type === 'Video'
        ? el('video', { class: 'doc-media', src: m.url, controls: true, preload: 'metadata', playsinline: true })
        : el('img', { class: 'doc-media', src: m.url, alt: m.name, loading: 'lazy' }));
    }

    if (files.length) {
      body.append(el('h4', { text: 'Documents' }), el('ul', { class: 'doclist' },
        files.map((d) => el('li', {}, el('a', {
          href: d.url, target: '_blank', rel: 'noopener',
        }, d.name, el('span', { class: 'muted', text: ` · ${d.type}, ${d.size}` }))))));
    }
  }

  if (p.approvals) {
    const a = p.approvals;
    body.append(el('h4', { text: 'Land and approvals' }), el('dl', { class: 'kv' },
      a.village ? kv('Revenue village', a.village) : null,
      a.surveyNos ? kv('Survey numbers', a.surveyNos.join(', ')) : null,
      a.totalArea ? kv('Extent', a.totalArea) : null,
      ...(a.conversionOrders || []).map((c) =>
        kv(`Conversion, Sy. ${c.surveyNo}`, `Order ${c.order} dated ${c.date}`))));
    if (a.layoutStatus) body.append(el('p', { class: 'note warn', text: a.layoutStatus }));
    if (a.notes) body.append(el('p', { class: 'note', text: a.notes }));
  }

  body.append(
    el('div', { class: 'actions' },
      el('a', { href: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`, target: '_blank', rel: 'noopener', text: 'Open in Google Maps' }),
      ...(p.links || []).map((l) => el('a', { href: l.url, target: '_blank', rel: 'noopener', text: l.label })),
      p.builderWebsite ? el('a', { href: p.builderWebsite, target: '_blank', rel: 'noopener', text: 'Builder site' }) : null,
      el('a', { href: `/api/projects/${p.id}`, target: '_blank', rel: 'noopener', text: 'View JSON' })),
    el('p', { class: 'note', text: p.coordsApproximate
      ? 'The map pin for this project is an estimate from its postal address, not a surveyed location. The price band is indicative, not a quote. Confirm RERA registration, pricing and possession with the developer.'
      : 'Location is a locality-level approximation and the price band is indicative, not a quote. Confirm RERA registration, pricing and possession with the developer.' })
  );
}

export function select(id, { pan = true } = {}) {
  const p = rows.find((x) => x.id === id);
  if (!p) return;
  selectedId = id;

  for (const card of document.querySelectorAll('.card')) card.setAttribute('aria-current', String(card.dataset.id === id));
  document.querySelector(`.card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  highlightPin(id);
  if (pan) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });

  renderDetail(p, $('#detailBody'));
  $('#detail').hidden = false;
  onSelect(id);
}

export function clearSelection() {
  selectedId = null;
  highlightPin(null);
  for (const card of document.querySelectorAll('.card')) card.setAttribute('aria-current', 'false');
}

/* ---------- refresh ---------- */

export async function refresh({ q, listEl, countEl, refit = true }) {
  const data = await getProjects(queryString(q));
  rows = withDistance(data.projects);
  renderResults(listEl, countEl, data);
  buildMarkers();
  syncChips();

  if (selectedId && !rows.some((p) => p.id === selectedId)) return { data, dropped: true };
  if (selectedId) highlightPin(selectedId);
  else if (refit) fitTo(rows);
  return { data, dropped: false };
}

/** Re-render in place once the viewer's location arrives. */
export function applyLocation({ listEl, countEl, data }) {
  rows = withDistance(rows);
  renderResults(listEl, countEl, data);
  buildMarkers();
  if (selectedId) { highlightPin(selectedId); const p = rows.find((x) => x.id === selectedId); if (p) renderDetail(p, $('#detailBody')); }
}

export const getRows = () => rows;
