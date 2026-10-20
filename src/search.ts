import type { Place } from './types';

export interface Hit {
  place: Place;
  score: number;
  /** why it matched, e.g. "Room Ma101" — shown under the name */
  via?: string;
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Optimal string alignment distance (Levenshtein + adjacent swaps). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const allowedTypos = (len: number) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

/** 0..1 how well query words match a text; every query word must match something. */
function textScore(query: string, text: string): number {
  const t = norm(text);
  if (!t) return 0;
  if (t === query) return 1;
  if (t.startsWith(query)) return 0.9;
  if (t.includes(query)) return 0.75;
  const words = t.split(' ');
  let total = 0;
  for (const q of query.split(' ')) {
    let best = 0;
    for (const w of words) {
      if (w === q) best = Math.max(best, 1);
      else if (w.startsWith(q) && q.length >= 2) best = Math.max(best, 0.85);
      else {
        const max = allowedTypos(q.length);
        if (max) {
          // compare against the word, and against its prefix so "mandle" ~ "mandela"
          const d = Math.min(editDistance(q, w, max), editDistance(q, w.slice(0, q.length), max));
          if (d <= max) best = Math.max(best, 0.7 - d * 0.1);
        }
      }
    }
    if (!best) return 0;
    total += best;
  }
  return (total / query.split(' ').length) * 0.8;
}

/** Timetable room codes like "Ma101", "MS 2.03", "Fi-G12" resolve to the building with that prefix. */
function roomMatch(raw: string, places: Place[]): Hit | null {
  const m = raw.trim().match(/^([A-Za-z]{1,4})[\s\-.]?(\d[\w.]*|[A-Za-z]?\d[\w.]*)$/);
  if (!m) return null;
  const [, letters] = m;
  let best: Place | null = null;
  for (const p of places) {
    for (const prefix of p.roomCodePrefixes) {
      // case-sensitive first (Ma vs MS), then case-insensitive
      if (letters === prefix || letters.toLowerCase() === prefix.toLowerCase()) {
        if (!best || prefix.length > best.roomCodePrefixes[0].length) best = p;
      }
    }
  }
  return best ? { place: best, score: 1.2, via: `Room ${raw.trim()}` } : null;
}

export function search(raw: string, places: Place[], limit = 8): Hit[] {
  const q = norm(raw);
  if (!q) return [];
  const hits = new Map<string, Hit>();
  const add = (h: Hit) => {
    const prev = hits.get(h.place.id);
    if (!prev || h.score > prev.score) hits.set(h.place.id, h);
  };

  const room = roomMatch(raw, places);
  if (room) add(room);

  for (const p of places) {
    if (p.code && norm(p.code) === q) add({ place: p, score: 1.1, via: `Code ${p.code}` });
    const name = norm(p.name) === q ? 1.3 : textScore(q, p.name);
    if (name) add({ place: p, score: name });
    for (const a of p.aliases) {
      // an alias typed in full (e.g. "QB054" for the prayer rooms) beats the room-code rule
      const s = norm(a) === q && q.length >= 4 ? 1.25 : textScore(q, a) * 0.95;
      if (s) add({ place: p, score: s, via: a });
    }
    const d = textScore(q, p.description) * 0.6;
    if (d) add({ place: p, score: d });
  }
  return [...hits.values()]
    // ties: entrances last, then the shorter (closer) name, so "libary" → Library before Library Café
    .sort((a, b) => b.score - a.score
      || Number(a.place.category === 'entrance') - Number(b.place.category === 'entrance')
      || a.place.name.length - b.place.name.length)
    .slice(0, limit);
}
