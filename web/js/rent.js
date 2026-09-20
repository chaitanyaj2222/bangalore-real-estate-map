/* Rent mode: sample rental listings, Airbnb-style. */

import { $, el, escapeHtml, nfmt, rupees, rentPill, haversineKm, formatKm } from './util.js';
import { getRentals, getRentalFacets } from './api.js';
import { map, markerLayer, fitTo, getUserLatLng } from './mapview.js';

export const state = {
  bhk: new Set(), zone: new Set(), type: new Set(), furnishing: new Set(),
  maxRent: null, pets: false, sort: 'rent_asc',
};

let facets = null;
let rows = [];
let selectedId = null;
let onSelect = () => {};

export const getSelectedId = () => selectedId;
export const setOnSelect = (fn) => (onSelect = fn);

export async function loadFacets() {
  facets = await getRentalFacets();
  return facets;
}

export function queryString(q) {
  const qs = new URLSearchParams();
  if (state.bhk.size) qs.set('bhk', [...state.bhk].join(','));
  for (const [key, param] of [['zone', 'zone'], ['type', 'type'], ['furnishing', 'furnishing']]) {
    if (state[key].size) qs.set(param, [...state[key]].join(','));
  }
  if (state.maxRent != null) qs.set('maxRent', state.maxRent);
  if (state.pets) qs.set('pets', 'true');
  if (q) qs.set('q', q);
  if (state.sort !== 'rent_asc') qs.set('sort', state.sort);
  return qs;
}

const withDistance = (list) => {
  const me = getUserLatLng();
  return list.map((r) => ({ ...r, distanceKm: me ? haversineKm(me, r) : null }));
};

/* ---------- price-pill markers ---------- */

function buildMarkers() {
  markerLayer.clearLayers();
  for (const r of rows) {
    const marker = L.marker([r.lat, r.lng], {
      title: r.title,
      riseOnHover: true,
      icon: L.divIcon({
        className: '',
        html: `<div class="rent-pin" data-id="${r.id}">${rentPill(r.rentPerMonth)}</div>`,
        iconSize: [52, 26],
        iconAnchor: [26, 13],
      }),
    });
    marker.on('click', () => select(r.id, { pan: false }));
    marker.on('mouseover', () => highlightCard(r.id, true));
    marker.on('mouseout', () => highlightCard(r.id, false));
    marker.addTo(markerLayer);
  }
  if (selectedId) highlightPin(selectedId);
}

export function highlightPin(id) {
  for (const node of document.querySelectorAll('.rent-pin')) node.classList.toggle('is-active', node.dataset.id === id);
}

function highlightCard(id, on) {
  document.querySelector(`.rcard[data-id="${id}"]`)?.classList.toggle('is-hot', on);
}

function hoverPin(id, on) {
  document.querySelector(`.rent-pin[data-id="${id}"]`)?.classList.toggle('is-hot', on);
}

/* ---------- images ---------- */

/** Gradient stand-in drawn when a placeholder photo fails to load (offline, blocked). */
function fallbackFor(seed) {
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))`;
}

function photo(src, seed, alt, className) {
  const img = el('img', { src, alt, loading: 'lazy', class: className });
  img.addEventListener('error', () => {
    img.replaceWith(el('div', { class: `${className} img-fallback`, style: `background:${fallbackFor(seed)}` }));
  });
  return img;
}

/* ---------- filters ---------- */

function chip(key, value, label, count, refresh) {
  return el('button', {
    type: 'button', class: 'chip', 'data-rkey': key, 'data-value': String(value),
    'aria-pressed': String(state[key].has(value)),
    onclick: () => { state[key].has(value) ? state[key].delete(value) : state[key].add(value); refresh(); },
  }, label, count != null ? el('span', { class: 'n', text: count }) : null);
}

const group = (title, children) =>
  el('div', { class: 'fgroup' }, el('h3', { text: title }), el('div', { class: 'chips' }, children));

export function renderFilters(wrap, refresh) {
  wrap.textContent = '';
  wrap.append(
    group('Bedrooms', facets.bhk.map((b) => chip('bhk', b.value, `${b.value} BHK`, b.count, refresh))),
    group('Furnishing', facets.furnishing.map((f) => chip('furnishing', f.value, f.value, f.count, refresh))),
    group('Zone', facets.zones.map((z) => chip('zone', z.value, z.value, z.count, refresh))),
    group('Type', facets.propertyTypes.map((t) => chip('type', t.value, t.value, t.count, refresh)))
  );

  const ceiling = Math.ceil(facets.rent.max / 5000) * 5000;
  const slider = el('input', { type: 'range', min: String(facets.rent.min), max: String(ceiling), step: '1000',
    value: String(state.maxRent ?? ceiling), 'aria-label': 'Maximum monthly rent' });
  const out = el('output');
  const sync = () => { out.textContent = Number(slider.value) >= ceiling ? 'Any' : `up to ${rupees(Number(slider.value))}`; };
  slider.addEventListener('input', sync);
  slider.addEventListener('change', () => {
    state.maxRent = Number(slider.value) >= ceiling ? null : Number(slider.value);
    refresh();
  });
  sync();

  const pets = el('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(state.pets),
    onclick: () => { state.pets = !state.pets; refresh(); },
  }, 'Pets allowed', el('span', { class: 'n', text: facets.petsAllowed }));
  pets.dataset.pets = '1';

  wrap.append(
    el('div', { class: 'fgroup' }, el('h3', { text: 'Monthly rent' }), el('div', { class: 'price-row' }, slider, out)),
    el('div', { class: 'fgroup' }, el('div', { class: 'chips' }, pets))
  );
}

export function syncChips() {
  for (const node of document.querySelectorAll('.chip[data-rkey]')) {
    const set = state[node.dataset.rkey];
    if (!set) continue;
    const raw = node.dataset.value;
    const value = node.dataset.rkey === 'bhk' ? Number(raw) : raw;
    node.setAttribute('aria-pressed', String(set.has(value)));
  }
  document.querySelector('.chip[data-pets]')?.setAttribute('aria-pressed', String(state.pets));
}

export function resetFilters() {
  for (const key of ['bhk', 'zone', 'type', 'furnishing']) state[key].clear();
  state.maxRent = null;
  state.pets = false;
}

/* ---------- listing cards ---------- */

export function renderResults(listEl, countEl, data) {
  countEl.textContent = data.count === data.total ? `${data.total} homes` : `${data.count} of ${data.total} homes`;
  listEl.textContent = '';

  if (!rows.length) {
    listEl.append(el('li', { class: 'empty' }, 'No rentals match these filters.'));
    return;
  }

  for (const r of rows) {
    const cover = r.images[0];
    listEl.append(el('li', {
      class: 'rcard', 'data-id': r.id, tabindex: '0', role: 'button',
      'aria-current': String(selectedId === r.id),
      onclick: () => select(r.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.id); } },
      onmouseenter: () => hoverPin(r.id, true),
      onmouseleave: () => hoverPin(r.id, false),
    },
      el('div', { class: 'rcard-media' }, photo(cover.thumb, r.id, r.title, 'rcard-img')),
      el('div', { class: 'rcard-body' },
        el('div', { class: 'rcard-top' },
          el('h3', { text: r.title }),
          el('span', { class: 'rating', title: `${r.reviews} reviews` }, '★ ', String(r.rating))),
        el('p', { class: 'loc', text: `${r.bhk} BHK · ${r.furnishing} · ${r.locality}` }),
        el('p', { class: 'rent' }, el('b', { text: rupees(r.rentPerMonth) }), ' / month'),
        el('div', { class: 'tags' },
          el('span', { class: 'tag', text: `${nfmt(r.areaSqft)} sq ft` }),
          r.petsAllowed ? el('span', { class: 'tag', text: 'Pets ok' }) : null,
          r.distanceKm != null ? el('span', { class: 'tag dist', text: `${formatKm(r.distanceKm)} away` }) : null))
    ));
  }
}

/* ---------- detail panel with gallery ---------- */

const kv = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', { text: value }));

function gallery(r) {
  let index = 0;
  const stage = el('div', { class: 'gal-stage' });
  const counter = el('span', { class: 'gal-count' });

  const draw = () => {
    stage.textContent = '';
    stage.append(photo(r.images[index].url, `${r.id}-${index}`, `${r.title}, photo ${index + 1}`, 'gal-img'));
    counter.textContent = `${index + 1} / ${r.images.length}`;
    for (const [i, t] of thumbs.entries()) t.setAttribute('aria-current', String(i === index));
  };
  const step = (delta) => { index = (index + delta + r.images.length) % r.images.length; draw(); };

  const thumbs = r.images.map((img, i) =>
    el('button', { type: 'button', class: 'gal-thumb', 'aria-label': `Photo ${i + 1}`, onclick: () => { index = i; draw(); } },
      photo(img.thumb, `${r.id}-${i}`, '', 'gal-thumb-img')));

  const wrap = el('div', { class: 'gallery' },
    el('div', { class: 'gal-frame' },
      stage,
      el('button', { type: 'button', class: 'gal-nav prev', 'aria-label': 'Previous photo', onclick: () => step(-1) }, '‹'),
      el('button', { type: 'button', class: 'gal-nav next', 'aria-label': 'Next photo', onclick: () => step(1) }, '›'),
      counter),
    el('div', { class: 'gal-thumbs' }, thumbs));

  draw();
  return wrap;
}

function renderDetail(r, body) {
  body.textContent = '';
  const available = new Date(r.availableFrom).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  body.append(
    gallery(r),
    el('h2', { text: r.title }),
    el('p', { class: 'sub' },
      `${r.locality} · ${r.zone} Bengaluru`,
      el('span', { class: 'rating inline' }, ' ★ ', String(r.rating), el('span', { class: 'muted', text: ` (${r.reviews})` }))),
    r.distanceKm != null
      ? el('p', { class: 'dist-line', text: `${formatKm(r.distanceKm)} from your location, straight line` })
      : null,
    el('p', { class: 'rent-big' }, el('b', { text: rupees(r.rentPerMonth) }), ' / month'),
    el('dl', { class: 'kv' },
      kv('Deposit', `${rupees(r.deposit)} (${r.depositMonths} mo)`),
      kv('Maintenance', `${rupees(r.maintenancePerMonth)} / mo`),
      kv('Configuration', `${r.bhk} BHK ${r.propertyType}`),
      kv('Built-up area', `${nfmt(r.areaSqft)} sq ft`),
      kv('Furnishing', r.furnishing),
      kv('Floor', r.floor),
      kv('Facing', r.facing),
      kv('Available from', available),
      kv('Preferred tenants', r.preferredTenants),
      kv('Pets', r.petsAllowed ? 'Allowed' : 'Not allowed')),
    el('h4', { text: 'About this home' }),
    el('p', { class: 'desc', text: r.description }),
    el('h4', { text: 'Amenities' }),
    el('div', { class: 'amenities' }, r.amenities.map((a) => el('span', { class: 'tag', text: a }))),
    el('div', { class: 'actions' },
      el('a', { href: `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`, target: '_blank', rel: 'noopener', text: 'Open in Google Maps' }),
      el('a', { href: `/api/rentals/${r.id}`, target: '_blank', rel: 'noopener', text: 'View JSON' })),
    el('p', { class: 'note warn', text: 'Sample listing. This home, its rent, availability and photos are demo data generated for this project - it is not real inventory. Do not contact anyone or transfer money based on it.' })
  );
}

export function select(id, { pan = true } = {}) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  selectedId = id;

  for (const card of document.querySelectorAll('.rcard')) card.setAttribute('aria-current', String(card.dataset.id === id));
  document.querySelector(`.rcard[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  highlightPin(id);
  if (pan) map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });

  renderDetail(r, $('#detailBody'));
  $('#detail').hidden = false;
  onSelect(id);
}

export function clearSelection() {
  selectedId = null;
  highlightPin(null);
  for (const card of document.querySelectorAll('.rcard')) card.setAttribute('aria-current', 'false');
}

export async function refresh({ q, listEl, countEl, refit = true }) {
  const data = await getRentals(queryString(q));
  rows = withDistance(data.rentals);
  renderResults(listEl, countEl, data);
  buildMarkers();
  syncChips();

  if (selectedId && !rows.some((r) => r.id === selectedId)) return { data, dropped: true };
  if (!selectedId && refit) fitTo(rows, { maxZoom: 14 });
  return { data, dropped: false };
}

export function applyLocation({ listEl, countEl, data }) {
  rows = withDistance(rows);
  renderResults(listEl, countEl, data);
  buildMarkers();
  if (selectedId) { const r = rows.find((x) => x.id === selectedId); if (r) renderDetail(r, $('#detailBody')); }
}

export const getRows = () => rows;
