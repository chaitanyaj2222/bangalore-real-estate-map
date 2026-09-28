import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'developers.json');

/** "P.N.C. Menon" -> "PM", "Irfan Razack" -> "IR" */
function initials(name) {
  const words = name.replace(/[^A-Za-z.\s]/g, ' ').split(/\s+/).filter(Boolean);
  const letters = words.map((w) => w[0].toUpperCase());
  return (letters[0] || '?') + (letters.length > 1 ? letters[letters.length - 1] : '');
}

const TINTS = ['#4b5563', '#7c3aed', '#0f766e', '#be123c', '#b45309', '#1d4ed8', '#166534', '#9333ea'];

/** Hash picks the starting tint; the index walks from there so leaders in one
 *  profile never land on the same colour. */
const tintFor = (seed, index) => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[(h + index) % TINTS.length];
};

class DeveloperStore {
  constructor() {
    const file = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    this.meta = file.meta;
    this.developers = file.developers.map((d) => ({
      ...d,
      leadership: (d.leadership || []).map((p, i) => ({
        ...p,
        initials: initials(p.name),
        avatarColor: tintFor(d.id, i),
      })),
      searchBlob: [
        d.name, d.shortName, d.tradingAs, d.hq, d.summary,
        ...(d.markets || []),
        ...(d.specialties || []),
        ...(d.notableProjects || []).map((p) => p.name),
        ...(d.leadership || []).map((p) => p.name),
      ].join(' ').toLowerCase(),
    }));
    this.loadedAt = new Date().toISOString();
  }

  query({ q } = {}) {
    const needle = q?.trim().toLowerCase();
    if (!needle) return [...this.developers];
    return this.developers.filter((d) => d.searchBlob.includes(needle));
  }

  byId(id) {
    return this.developers.find((d) => d.id === id) || null;
  }

  /** Card-sized projection for the list: no history, no leadership bios. */
  summaries(list = this.developers) {
    return list.map((d) => ({
      id: d.id,
      name: d.name,
      shortName: d.shortName,
      tradingAs: d.tradingAs,
      color: d.color,
      hq: d.hq,
      founded: d.founded,
      summary: d.summary,
      markets: d.markets,
      stats: d.stats,
      leaderCount: d.leadership.length,
    }));
  }
}

export const developerStore = new DeveloperStore();
export const stripBlob = ({ searchBlob, ...rest }) => rest;
