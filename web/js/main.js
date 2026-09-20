/* Boot, mode switching, and everything shared between buy and rent. */

import { $, el, debounce } from './util.js';
import { getStats, getRoads } from './api.js';
import { map, renderRoads, setRoadCategory, locateUser, onUserLocation, getUserLatLng, fitTo } from './mapview.js';
import * as buy from './buy.js';
import * as rent from './rent.js';

const modes = { buy, rent };
let mode = 'buy';
let searchText = '';
let lastData = { buy: null, rent: null };

const current = () => modes[mode];

/* ---------- refresh ---------- */

async function refresh({ refit = true } = {}) {
  const { data, dropped } = await current().refresh({
    q: searchText,
    listEl: $('#results'),
    countEl: $('#resultCount'),
    refit,
  });
  lastData[mode] = data;
  if (dropped) closeDetail();
  syncUrl();
  return data;
}

const refreshSoon = debounce(() => refresh(), 180);

/* ---------- url state ---------- */

function syncUrl() {
  const qs = current().queryString(searchText);
  if (mode !== 'buy') qs.set('mode', mode);
  const id = current().getSelectedId();
  if (id) qs.set(mode === 'buy' ? 'project' : 'home', id);
  history.replaceState(null, '', qs.toString() ? `?${qs}` : location.pathname);
}

function readUrl() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('mode') === 'rent') mode = 'rent';
  searchText = qs.get('q') || '';

  const sets = mode === 'buy'
    ? [['builder', 'builder'], ['zone', 'zone'], ['type', 'type'], ['status', 'status'], ['config', 'config']]
    : [['bhk', 'bhk'], ['zone', 'zone'], ['type', 'type'], ['furnishing', 'furnishing']];

  for (const [stateKey, param] of sets) {
    const raw = qs.get(param);
    if (!raw) continue;
    const values = raw.split(',').filter(Boolean).map((v) => (stateKey === 'bhk' ? Number(v) : v));
    current().state[stateKey] = new Set(values);
  }
  if (qs.get('maxPrice')) buy.state.maxPrice = Number(qs.get('maxPrice'));
  if (qs.get('maxRent')) rent.state.maxRent = Number(qs.get('maxRent'));
  if (qs.get('pets') === 'true') rent.state.pets = true;
  if (qs.get('sort')) current().state.sort = qs.get('sort');

  return qs.get('project') || qs.get('home') || null;
}

/* ---------- detail ---------- */

function closeDetail() {
  buy.clearSelection();
  rent.clearSelection();
  $('#detail').hidden = true;
  syncUrl();
}

/* ---------- mode switch ---------- */

const SORTS = {
  buy: [['name', 'Name'], ['newest', 'Newest launch'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['size', 'Land area']],
  rent: [['rent_asc', 'Rent: low to high'], ['rent_desc', 'Rent: high to low'], ['rating', 'Rating'], ['size', 'Size'], ['name', 'Name']],
};

function renderSortOptions() {
  const select = $('#sort');
  select.textContent = '';
  for (const [value, label] of SORTS[mode]) select.append(el('option', { value, text: label }));
  select.value = current().state.sort;
}

async function setMode(next, { refit = true } = {}) {
  if (next === mode) return;
  mode = next;
  closeDetail();

  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  document.body.classList.toggle('mode-rent', mode === 'rent');
  $('#results').className = mode === 'rent' ? 'results results-rent' : 'results';
  $('#search').placeholder = mode === 'rent'
    ? 'Search locality, BHK or furnishing…'
    : 'Search project, locality or corridor…';

  renderSortOptions();
  current().renderFilters($('#filterGroups'), () => refresh());
  renderLegend();
  renderTopbarStats();
  $('#disclaimer').textContent = mode === 'rent' ? rentFacets.meta.disclaimer : saleStats.meta.disclaimer;
  await refresh({ refit });
}

/* ---------- legend + road controls ---------- */

function renderLegend() {
  const wrap = $('#legend');
  wrap.textContent = '';

  const roads = getRoadList();
  const rings = roads.filter((r) => r.category === 'ring');

  wrap.append(el('div', { class: 'legend-title', text: mode === 'buy' ? 'Builders' : 'Rentals' }));

  if (mode === 'buy') {
    for (const b of buyFacets.builders) {
      wrap.append(el('div', { class: 'row' }, el('span', { class: 'dot', style: `background:${b.color}` }), `${b.shortName} (${b.count})`));
    }
    wrap.append(el('div', { class: 'row muted', text: 'Pin size ≈ unit count' }));
  } else {
    wrap.append(el('div', { class: 'row' }, el('span', { class: 'pill-key' }, '₹45K'), 'Monthly rent'));
    wrap.append(el('div', { class: 'row muted', text: 'Sample listings, not real inventory' }));
  }

  wrap.append(el('div', { class: 'legend-title', text: 'Roads' }));
  for (const r of rings) {
    wrap.append(el('div', { class: 'row' },
      el('span', { class: `line-key${r.dashed ? ' dashed' : ''}`, style: `--rc:${r.color}` }),
      `${r.shortName}`,
      el('span', { class: 'muted', text: ` · ${r.status}` })));
  }

  const toggle = (category, label, checked) => {
    const box = el('input', { type: 'checkbox', checked, onchange: (e) => setRoadCategory(category, e.target.checked) });
    return el('label', { class: 'road-toggle' }, box, label);
  };
  wrap.append(el('div', { class: 'legend-toggles' },
    toggle('ring', 'Ring roads', true),
    toggle('radial', 'Arterial roads', false)));
}

let buyFacets = null;
let rentFacets = null;
let roadList = [];
const getRoadList = () => roadList;

/* ---------- location ---------- */

function setLocationStatus(text, kind = '') {
  const node = $('#locStatus');
  node.textContent = text || '';
  node.className = `loc-status ${kind}`;
}

async function handleLocate() {
  const btn = $('#locateBtn');
  btn.disabled = true;
  setLocationStatus('Locating…');
  try {
    const me = await locateUser();
    setLocationStatus(`Located to ±${Math.round(me.accuracy)} m`, 'ok');
    map.setView([me.lat, me.lng], Math.max(map.getZoom(), 12));
  } catch (err) {
    setLocationStatus(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- chrome ---------- */

let saleStats = null;

function renderTopbarStats() {
  const wrap = $('#topbarStats');
  wrap.textContent = '';

  const pairs = mode === 'buy'
    ? [
        [saleStats.totalProjects.toLocaleString('en-IN'), 'Projects'],
        [saleStats.totalUnits.toLocaleString('en-IN'), 'Units'],
        [Math.round(saleStats.totalAcres).toLocaleString('en-IN'), 'Acres'],
        [String(saleStats.byBuilder.length), 'Builders'],
      ]
    : [
        [String(rentFacets.total), 'Homes'],
        [`₹${Math.round(rentFacets.rent.min / 1000)}K`, 'From'],
        [`₹${Math.round(rentFacets.rent.max / 1000)}K`, 'Up to'],
        [String(rentFacets.zones.length), 'Zones'],
      ];

  for (const [value, label] of pairs) {
    wrap.append(el('div', { class: 'stat' }, el('b', { text: value }), el('span', { text: label })));
  }
}

function wireEvents() {
  $('#search').addEventListener('input', (e) => { searchText = e.target.value.trim(); refreshSoon(); });
  $('#sort').addEventListener('change', (e) => { current().state.sort = e.target.value; refresh({ refit: false }); });

  $('#resetFilters').addEventListener('click', () => {
    current().resetFilters();
    searchText = '';
    $('#search').value = '';
    current().renderFilters($('#filterGroups'), () => refresh());
    refresh();
  });

  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  }

  $('#locateBtn').addEventListener('click', handleLocate);
  $('#detailClose').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

  const toggleBtn = $('#mobileToggle');
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('show-map');
    const onMap = document.body.classList.contains('show-map');
    toggleBtn.textContent = onMap ? 'List' : 'Map';
    if (!onMap) return;
    // The map container was display:none until now, so Leaflet has stale dimensions.
    const id = current().getSelectedId();
    const active = id && current().getRows().find((x) => x.id === id);
    if (active) {
      map.invalidateSize();
      map.setView([active.lat, active.lng], Math.max(map.getZoom(), 13));
    } else {
      fitTo(current().getRows(), { maxZoom: mode === 'rent' ? 14 : 13 });
    }
  });

  // Distances appear everywhere at once, the moment we learn where the viewer is.
  onUserLocation(() => {
    current().applyLocation({ listEl: $('#results'), countEl: $('#resultCount'), data: lastData[mode] });
  });

  buy.setOnSelect(syncUrl);
  rent.setOnSelect(syncUrl);
}

/* ---------- boot ---------- */

async function init() {
  const pendingId = readUrl();
  $('#search').value = searchText;

  const [stats, facetsBuy, facetsRent, roads] = await Promise.all([
    getStats(),
    buy.loadFacets(),
    rent.loadFacets(),
    getRoads(),
  ]);

  saleStats = stats;
  buyFacets = facetsBuy;
  rentFacets = facetsRent;
  roadList = roads.roads;
  renderRoads(roadList);
  setRoadCategory('ring', true);

  $('#disclaimer').textContent = mode === 'rent' ? rentFacets.meta.disclaimer : stats.meta.disclaimer;
  renderTopbarStats();

  // Paint the mode we booted into without going through the switch animation.
  document.body.classList.toggle('mode-rent', mode === 'rent');
  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  $('#results').className = mode === 'rent' ? 'results results-rent' : 'results';
  renderSortOptions();
  current().renderFilters($('#filterGroups'), () => refresh());
  renderLegend();
  wireEvents();

  await refresh();
  fitTo(current().getRows(), { maxZoom: mode === 'rent' ? 14 : 13 });

  if (pendingId) current().select(pendingId);
}

init().catch((err) => {
  console.error(err);
  $('#results').innerHTML = '<li class="empty">Could not load data. Is the server running?</li>';
});
