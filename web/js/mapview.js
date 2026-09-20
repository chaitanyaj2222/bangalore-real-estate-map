/* Leaflet map, road overlays and the viewer's own location. */

import { el, escapeHtml, formatKm } from './util.js';

const BLR = { center: [12.99, 77.6], zoom: 11 };

// zoomSnap below 1 lets fitBounds land on a fractional zoom. At the default of 1
// it rounds down to the next whole level, which can frame the data ~2x too wide.
export const map = L.map('map', { zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5 })
  .setView(BLR.center, BLR.zoom);

// Keyless raster tiles. CARTO / Stadia / Mapbox all want an API key now; if you
// sign up for one, swap the url + attribution here and nothing else changes.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);

/* Panes fix the stacking order: roads under markers, always. */
map.createPane('roadsPane').style.zIndex = 380;
map.createPane('roadHalo').style.zIndex = 375;

export const markerLayer = L.layerGroup().addTo(map);

/* ---------- roads ---------- */

const roadLayers = { ring: L.layerGroup(), radial: L.layerGroup() };
let roadsData = [];

export function renderRoads(roads) {
  roadsData = roads;
  for (const group of Object.values(roadLayers)) group.clearLayers();

  for (const road of roads) {
    const group = roadLayers[road.category];
    if (!group) continue;

    // A wider translucent halo under each line keeps rings legible over busy tiles.
    if (road.category === 'ring') {
      L.polyline(road.path, {
        pane: 'roadHalo',
        color: road.color,
        weight: road.weight + 6,
        opacity: 0.16,
        lineCap: 'round',
        interactive: false,
      }).addTo(group);
    }

    const line = L.polyline(road.path, {
      pane: 'roadsPane',
      color: road.color,
      weight: road.weight,
      opacity: road.category === 'ring' ? 0.95 : 0.55,
      dashArray: road.dashed ? '10 7' : null,
      lineCap: 'round',
      lineJoin: 'round',
    });

    line.bindTooltip(
      `<b>${escapeHtml(road.shortName)}</b> · ${escapeHtml(road.status)}<br>${escapeHtml(road.note)}`,
      { sticky: true, className: 'road-tip' }
    );
    line.on('mouseover', () => line.setStyle({ weight: road.weight + 3, opacity: 1 }));
    line.on('mouseout', () => line.setStyle({ weight: road.weight, opacity: road.category === 'ring' ? 0.95 : 0.55 }));
    line.addTo(group);
  }
}

export function setRoadCategory(category, on) {
  const group = roadLayers[category];
  if (!group) return;
  if (on) group.addTo(map);
  else map.removeLayer(group);
}

export const getRoads = () => roadsData;

/* ---------- the viewer's location ---------- */

let userLatLng = null;
let userLayer = null;
const listeners = new Set();

export const getUserLatLng = () => userLatLng;
export const onUserLocation = (fn) => listeners.add(fn);

function drawUser(lat, lng, accuracy) {
  if (userLayer) map.removeLayer(userLayer);
  userLayer = L.layerGroup([
    L.circle([lat, lng], {
      radius: Math.min(accuracy || 0, 2000),
      color: '#1d4ed8',
      weight: 1,
      fillColor: '#3b82f6',
      fillOpacity: 0.12,
      interactive: false,
    }),
    L.marker([lat, lng], {
      zIndexOffset: 2000,
      icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).bindTooltip('You are here', { direction: 'top', offset: [0, -10] }),
  ]).addTo(map);
}

/**
 * Ask the browser for the viewer's position. Requires a secure context, so this
 * works on localhost and over HTTPS but silently fails on plain http:// hosts.
 * @returns {Promise<{lat:number,lng:number,accuracy:number}>}
 */
export function locateUser() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser has no geolocation support.'));
    if (!window.isSecureContext) return reject(new Error('Location needs HTTPS or localhost.'));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        userLatLng = { lat, lng, accuracy };
        drawUser(lat, lng, accuracy);
        for (const fn of listeners) fn(userLatLng);
        resolve(userLatLng);
      },
      (err) => {
        const messages = {
          1: 'Location permission denied. Allow it in the browser address bar to see distances.',
          2: 'Your position is unavailable right now.',
          3: 'Timed out while locating you.',
        };
        reject(new Error(messages[err.code] || err.message));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

/** Straight-line distance chip, or null when we don't know where the viewer is. */
export function distanceChip(km) {
  const label = formatKm(km);
  return label ? el('span', { class: 'tag dist', title: 'Straight-line distance from your location' }, `${label} away`) : null;
}

/* ---------- framing ---------- */

export function fitTo(points, { maxZoom = 13 } = {}) {
  if (!points.length) return;
  map.invalidateSize();
  map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
    padding: [50, 50],
    maxZoom,
    animate: false,
  });
}
