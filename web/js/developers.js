/* Developers mode: editorial profiles of the builders behind the projects.
   No map markers here - the reading pane replaces the map. */

import { $, el } from './util.js';
import { getDevelopers } from './api.js';

export const state = { market: new Set(), sort: 'name' };

let all = [];
let rows = [];
let meta = null;
let selectedId = null;
let onSelect = () => {};

export const getSelectedId = () => selectedId;
export const setOnSelect = (fn) => (onSelect = fn);
export const getRows = () => rows;
export const getMeta = () => meta;

export async function loadAll() {
  const data = await getDevelopers();
  all = data.developers;
  meta = data.meta;
  return data;
}

export function queryString(q) {
  const qs = new URLSearchParams();
  if (state.market.size) qs.set('market', [...state.market].join(','));
  if (q) qs.set('q', q);
  if (state.sort !== 'name') qs.set('sort', state.sort);
  return qs;
}

/* ---------- filters ---------- */

const marketFacets = () => {
  const counts = new Map();
  for (const d of all) for (const m of d.markets) counts.set(m, (counts.get(m) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export function renderFilters(wrap, refresh) {
  wrap.textContent = '';
  const chips = marketFacets().map(([market, count]) =>
    el('button', {
      type: 'button', class: 'chip', 'data-key': 'market', 'data-value': market,
      'aria-pressed': String(state.market.has(market)),
      onclick: () => {
        state.market.has(market) ? state.market.delete(market) : state.market.add(market);
        refresh();
      },
    }, market, el('span', { class: 'n', text: count })));

  wrap.append(el('div', { class: 'fgroup' },
    el('h3', { text: 'Operating market' }),
    el('div', { class: 'chips' }, chips)));
}

export function syncChips() {
  for (const node of document.querySelectorAll('.chip[data-key="market"]')) {
    node.setAttribute('aria-pressed', String(state.market.has(node.dataset.value)));
  }
}

export function resetFilters() {
  state.market.clear();
}

/* ---------- list ---------- */

const SORTS = {
  name: (a, b) => a.shortName.localeCompare(b.shortName),
  oldest: (a, b) => a.founded - b.founded,
  newest: (a, b) => b.founded - a.founded,
};

function applyQuery(q) {
  const needle = q?.trim().toLowerCase();
  rows = all.filter((d) => {
    if (state.market.size && !d.markets.some((m) => state.market.has(m))) return false;
    if (!needle) return true;
    const blob = [d.name, d.tradingAs, d.hq, d.summary, ...d.markets,
      ...d.specialties, ...d.notableProjects.map((p) => p.name),
      ...d.leadership.map((p) => p.name)].join(' ').toLowerCase();
    return blob.includes(needle);
  });
  rows.sort(SORTS[state.sort] || SORTS.name);
}

export function renderResults(listEl, countEl) {
  countEl.textContent = rows.length === all.length
    ? `${all.length} developers`
    : `${rows.length} of ${all.length} developers`;
  listEl.textContent = '';

  if (!rows.length) {
    listEl.append(el('li', { class: 'empty' }, 'No developers match these filters.'));
    return;
  }

  for (const d of rows) {
    listEl.append(el('li', {
      class: 'card dev-card', style: `--card-color:${d.color}`, 'data-id': d.id,
      tabindex: '0', role: 'button', 'aria-current': String(selectedId === d.id),
      onclick: () => select(d.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(d.id); } },
    },
      el('div', { class: 'card-top' },
        el('h3', { text: d.shortName }),
        el('span', { class: 'price', text: `est. ${d.founded}` })),
      el('p', { class: 'loc', text: d.summary }),
      el('div', { class: 'tags' },
        el('span', { class: 'tag builder', style: `background:${d.color}`, text: d.hq }),
        ...d.markets.slice(0, 2).map((m) => el('span', { class: 'tag', text: m })),
        d.markets.length > 2 ? el('span', { class: 'tag', text: `+${d.markets.length - 2}` }) : null)
    ));
  }
}

/* ---------- profile pane ---------- */

function avatar(person) {
  if (person.photo) {
    return el('img', { class: 'lead-photo', src: person.photo, alt: person.name, loading: 'lazy' });
  }
  return el('div', {
    class: 'lead-photo lead-initials',
    style: `background:${person.avatarColor}`,
    'aria-hidden': 'true',
    text: person.initials,
  });
}

function renderProfile(d, pane) {
  pane.textContent = '';

  pane.append(el('header', { class: 'dev-head', style: `--dev-color:${d.color}` },
    el('span', { class: 'eyebrow', style: `background:${d.color}`, text: d.tradingAs }),
    el('h2', { text: d.name }),
    el('p', { class: 'dev-sub', text: `Founded ${d.founded} · Headquartered in ${d.hq}` }),
    el('div', { class: 'dev-links' },
      el('a', { href: d.website, target: '_blank', rel: 'noopener', text: 'Official site' }),
      el('a', { href: `/api/developers/${d.id}`, target: '_blank', rel: 'noopener', text: 'View JSON' }))));

  pane.append(el('section', { class: 'dev-stats' },
    d.stats.map((s) => el('div', { class: 'dev-stat' },
      el('b', { text: s.value }),
      el('span', { text: s.label })))));

  pane.append(el('section', { class: 'dev-block' },
    el('h3', { class: 'dev-h', text: 'History' }),
    d.history.map((p) => el('p', { class: 'dev-p', text: p }))));

  if (d.leadership.length) {
    pane.append(el('section', { class: 'dev-block' },
      el('h3', { class: 'dev-h', text: 'Leadership' }),
      el('div', { class: 'leads' },
        d.leadership.map((p) => el('article', { class: 'lead' },
          avatar(p),
          el('div', {},
            el('h4', { class: 'lead-name', text: p.name }),
            el('p', { class: 'lead-role', text: p.role }),
            p.bio ? el('p', { class: 'lead-bio', text: p.bio }) : null))))));
  } else {
    pane.append(el('section', { class: 'dev-block' },
      el('h3', { class: 'dev-h', text: 'Leadership' }),
      el('p', { class: 'dev-p muted', text: 'Leadership details are not recorded for this developer yet.' })));
  }

  pane.append(el('section', { class: 'dev-block' },
    el('h3', { class: 'dev-h', text: 'Notable projects' }),
    el('ul', { class: 'proj-list' },
      d.notableProjects.map((p) => el('li', {},
        el('b', { text: p.name }),
        el('span', { class: 'muted', text: ` · ${p.city}` }))))));

  if (d.recentDevelopments.length) {
    pane.append(el('section', { class: 'dev-block' },
      el('h3', { class: 'dev-h', text: 'Recent developments' }),
      el('ol', { class: 'timeline' },
        d.recentDevelopments.map((r) => el('li', {},
          el('span', { class: 'tl-when', text: r.when }),
          el('div', {},
            el('b', { text: r.title }),
            el('p', { class: 'dev-p', text: r.detail })))))));
  }

  pane.append(el('section', { class: 'dev-block' },
    el('h3', { class: 'dev-h', text: 'At a glance' }),
    el('dl', { class: 'kv' },
      el('div', {}, el('dt', { text: 'Specialities' }), el('dd', { text: d.specialties.join(', ') })),
      el('div', {}, el('dt', { text: 'Markets' }), el('dd', { text: d.markets.join(', ') })),
      el('div', {}, el('dt', { text: 'RERA' }), el('dd', { text: d.rera.join(', ') })),
      el('div', {}, el('dt', { text: 'Headquarters' }), el('dd', { text: d.hq })))));

  pane.append(el('p', { class: 'note', text: meta.disclaimer }));
  pane.append(el('p', { class: 'note', text: meta.photoNote }));
}

function renderEmptyPane(pane) {
  pane.textContent = '';
  pane.append(el('div', { class: 'dev-empty' },
    el('h2', { text: 'Who builds Bengaluru' }),
    el('p', { text: 'Pick a developer from the list to read their history, key numbers, leadership and recent moves.' })));
}

export function select(id) {
  const d = rows.find((x) => x.id === id);
  if (!d) return;
  selectedId = id;

  for (const card of document.querySelectorAll('.dev-card')) {
    card.setAttribute('aria-current', String(card.dataset.id === id));
  }
  document.querySelector(`.dev-card[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });

  const pane = $('#devPane');
  renderProfile(d, pane);
  pane.scrollTop = 0;
  document.body.classList.add('show-map');
  $('#mobileToggle').textContent = 'List';
  onSelect(id);
}

export function clearSelection() {
  selectedId = null;
  for (const card of document.querySelectorAll('.dev-card')) card.setAttribute('aria-current', 'false');
  renderEmptyPane($('#devPane'));
}

/* ---------- mode contract ---------- */

export async function refresh({ q, listEl, countEl }) {
  applyQuery(q);
  renderResults(listEl, countEl);
  syncChips();

  if (selectedId && !rows.some((d) => d.id === selectedId)) {
    selectedId = null;
    renderEmptyPane($('#devPane'));
    return { data: { count: rows.length }, dropped: true };
  }
  if (!selectedId) renderEmptyPane($('#devPane'));
  return { data: { count: rows.length }, dropped: false };
}

/** Developers have no coordinates, so viewer location changes nothing here. */
export function applyLocation() {}
