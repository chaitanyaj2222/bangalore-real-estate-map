/* Shared helpers: DOM building, formatting, geo math. */

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.setAttribute('style', v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return node;
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const nfmt = (n) => (n == null ? '—' : n.toLocaleString('en-IN'));

/* ---------- money ---------- */

/** 1.25 -> "1.25 Cr", 0.85 -> "85 L" */
export const crore = (n) => (n >= 1 ? `${Number(n.toFixed(2))} Cr` : `${Math.round(n * 100)} L`);

export const saleBand = (p) =>
  p.priceMinCr == null ? 'Price on request'
  : p.priceMinCr === p.priceMaxCr ? `₹${crore(p.priceMinCr)}`
  : `₹${crore(p.priceMinCr)} – ${crore(p.priceMaxCr)}`;

export const sizeBand = (p) =>
  p.sizeMinSqft == null ? '—'
  : `${nfmt(p.sizeMinSqft)} – ${nfmt(p.sizeMaxSqft)} sq ft`;

export const rupees = (n) => `₹${nfmt(n)}`;

/** 55000 -> "₹55K", 125000 -> "₹1.25L" - short enough for a map pin. */
export const rentPill = (n) =>
  n >= 100000 ? `₹${Number((n / 100000).toFixed(2))}L` : `₹${Math.round(n / 1000)}K`;

/* ---------- geo ---------- */

const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. Straight line, not a driving route. */
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(s));
}

export const formatKm = (km) =>
  km == null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

/** Debounce that keeps the latest call's arguments. */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
