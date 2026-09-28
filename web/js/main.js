/* Boot, mode switching, and everything shared between buy and rent. */

import { $, el, debounce } from './util.js';
import { getStats, getRoads } from './api.js';
import { map, renderRoads, setRoadCategory, locateUser, onUserLocation, getUserLatLng, fitTo } from './mapview.js';
import * as buy from './buy.js';
import * as rent from './rent.js';
import * as dev from './developers.js';

const modes = { buy, rent, dev };
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
  const idParam = { buy: 'project', rent: 'home', dev: 'developer' }[mode];
  if (id) qs.set(idParam, id);
  history.replaceState(null, '', qs.toString() ? `?${qs}` : location.pathname);
}

function readUrl() {
  const qs = new URLSearchParams(location.search);
  const wanted = qs.get('mode');
  if (wanted === 'rent' || wanted === 'dev') mode = wanted;
  searchText = qs.get('q') || '';

  const SETS = {
    buy: [['builder', 'builder'], ['zone', 'zone'], ['type', 'type'], ['status', 'status'], ['config', 'config']],
    rent: [['bhk', 'bhk'], ['zone', 'zone'], ['type', 'type'], ['furnishing', 'furnishing']],
    dev: [['market', 'market']],
  };
  const sets = SETS[mode];

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

  return qs.get('project') || qs.get('home') || qs.get('developer') || null;
}

/* ---------- detail ---------- */

function closeDetail() {
  buy.clearSelection();
  rent.clearSelection();
  dev.clearSelection();
  $('#detail').hidden = true;
  syncUrl();
}

/* ---------- mode switch ---------- */

const SORTS = {
  buy: [['name', 'Name'], ['newest', 'Newest launch'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['size', 'Land area']],
  rent: [['rent_asc', 'Rent: low to high'], ['rent_desc', 'Rent: high to low'], ['rating', 'Rating'], ['size', 'Size'], ['name', 'Name']],
  dev: [['name', 'Name'], ['oldest', 'Oldest first'], ['newest', 'Newest first']],
};

function renderSortOptions() {
  const select = $('#sort');
  select.textContent = '';
  for (const [value, label] of SORTS[mode]) select.append(el('option', { value, text: label }));
  select.value = current().state.sort;
}

const PLACEHOLDERS = {
  buy: 'Search project, locality or corridor…',
  rent: 'Search locality, BHK or furnishing…',
  dev: 'Search developer, founder or project…',
};

/** Repaint every piece of chrome that depends on the active mode. */
function paintChrome() {
  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  document.body.classList.toggle('mode-rent', mode === 'rent');
  document.body.classList.toggle('mode-dev', mode === 'dev');
  $('#devPane').hidden = mode !== 'dev';
  $('#results').className = mode === 'rent' ? 'results results-rent' : 'results';
  $('#search').placeholder = PLACEHOLDERS[mode];
  syncMobileToggleLabel();

  renderSortOptions();
  current().renderFilters($('#filterGroups'), () => refresh());
  renderLegend();
  renderTopbarStats();
  if (mode !== 'dev') {
    $('#disclaimer').textContent = mode === 'rent' ? rentFacets.meta.disclaimer : saleStats.meta.disclaimer;
  }
}

function syncMobileToggleLabel() {
  const onSecond = document.body.classList.contains('show-map');
  const second = mode === 'dev' ? 'Profile' : 'Map';
  $('#mobileToggle').textContent = onSecond ? 'List' : second;
}

async function setMode(next, { refit = true } = {}) {
  if (next === mode) return;
  mode = next;
  closeDetail();
  paintChrome();
  await refresh({ refit });
}

/* ---------- legend + road controls ---------- */

function renderLegend() {
  if (mode === 'dev') return;
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
let devAll = [];
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

  if (mode === 'dev') {
    const cities = new Set(devAll.flatMap((d) => d.markets));
    const leaders = devAll.reduce((n, d) => n + d.leadership.length, 0);
    const oldest = Math.min(...devAll.map((d) => d.founded));
    for (const [value, label] of [
      [String(devAll.length), 'Developers'],
      [String(cities.size), 'Cities'],
      [String(leaders), 'Leaders'],
      [String(oldest), 'Since'],
    ]) {
      wrap.append(el('div', { class: 'stat' }, el('b', { text: value }), el('span', { text: label })));
    }
    return;
  }

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
    syncMobileToggleLabel();
    if (!onMap || mode === 'dev') return;
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
  dev.setOnSelect(syncUrl);
}

/* ---------- boot ---------- */

async function init() {
  const pendingId = readUrl();
  $('#search').value = searchText;

  const [stats, facetsBuy, facetsRent, roads, developers] = await Promise.all([
    getStats(),
    buy.loadFacets(),
    rent.loadFacets(),
    getRoads(),
    dev.loadAll(),
  ]);

  saleStats = stats;
  buyFacets = facetsBuy;
  rentFacets = facetsRent;
  devAll = developers.developers;
  roadList = roads.roads;
  renderRoads(roadList);
  setRoadCategory('ring', true);

  paintChrome();
  wireEvents();

  await refresh();
  if (mode !== 'dev') fitTo(current().getRows(), { maxZoom: mode === 'rent' ? 14 : 13 });

  if (pendingId) current().select(pendingId);
}

init().catch((err) => {
  console.error(err);
  $('#results').innerHTML = '<li class="empty">Could not load data. Is the server running?</li>';
});
