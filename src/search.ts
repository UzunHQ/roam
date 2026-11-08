import type { Place } from './types';

export interface Hit {
  place: Place;
  score: number;
  /** why it matched, e.g. "Room Ma101" — shown under the name */
  via?: string;
  /** a timetable room code this hit stands for ("Ma101"): its building is known, the room's spot isn't */
  room?: string;
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

// short words get no typos at all: "halal" must not turn into "hall"
const allowedTypos = (len: number) => (len <= 4 ? 0 : len <= 7 ? 1 : 2);

/** A rough English stem, so "printer" finds "printing" and "curry" finds "curries". */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('ers')) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('er')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
/** a query word against a text word: prefix, or the same stem */
const wordHit = (q: string, x: string) => x.startsWith(q) || (q.length >= 3 && stem(x) === stem(q)) || (q.length >= 4 && stem(q).length >= 4 && x.startsWith(stem(q)));

/**
 * Everyday words for what the data calls something else. A query word found here is also tried as
 * each of its synonyms (scored a little lower than a direct match).
 */
const SYNONYMS: Record<string, string[]> = {
  printer: ['printing'], printers: ['printing'], print: ['printing'], copier: ['printing'], photocopy: ['printing'], photocopier: ['printing'],
  toilet: ['toilets', 'wc'], toilets: ['wc'], loo: ['toilets', 'wc'], wc: ['toilets'], bathroom: ['toilets', 'wc'],
  coffee: ['cafe'], tea: ['cafe'], latte: ['cafe', 'coffee'],
  lecture: ['lecture theatre', 'lecture halls', 'auditorium'], lectures: ['lecture theatre', 'lecture halls', 'auditorium'], theatre: ['lecture theatre', 'auditorium'],
  bike: ['bike storage', 'bicycle shelters'], bikes: ['bike storage', 'bicycle shelters'], bicycle: ['bike storage'], cycle: ['bike storage', 'bicycle shelters'],
  aid: ['first aid'], defibrillator: ['first aid'], aed: ['first aid'], injury: ['first aid'],
  gym: ['fitness'], fitness: ['gym'], workout: ['gym', 'fitness'],
  nurse: ['medical', 'health'], doctor: ['medical', 'health'], gp: ['medical', 'health'], clinic: ['medical', 'health'],
  microwave: ['heat food', 'warm your own food'], heat: ['heat food', 'warm your own food'],
  refill: ['water refill'], drinking: ['water refill'],
  cash: ['cash machine', 'atm'], atm: ['cash machine'],
  parcel: ['parcels', 'post room'], parcels: ['post room'], package: ['parcels', 'post room'], post: ['post room'],
  wifi: ['wi fi'], pray: ['prayer'], mosque: ['prayer'], computer: ['computers'], pcs: ['computers'],
};
function variants(q: string): string[] {
  const words = q.split(' ');
  const out: string[] = [];
  words.forEach((w, i) => {
    for (const syn of SYNONYMS[w] ?? []) out.push([...words.slice(0, i), syn, ...words.slice(i + 1)].join(' '));
  });
  return out;
}

/** 0..1 how well query words match a text; every query word must match something. */
function textScore(query: string, text: string): number {
  const t = norm(text);
  if (!t) return 0;
  if (t === query) return 1;
  if (t.startsWith(query)) return 0.9;
  if ((' ' + t).includes(' ' + query)) return 0.85; // starts a later word
  if (t.includes(query)) return 0.6;
  const words = t.split(' ');
  let total = 0;
  for (const q of query.split(' ')) {
    let best = 0;
    for (const w of words) {
      if (w === q) best = Math.max(best, 1);
      else if (w.startsWith(q) && q.length >= 2) best = Math.max(best, 0.85);
      else if (q.length >= 3 && stem(w) === stem(q)) best = Math.max(best, 0.8);
      else {
        const max = allowedTypos(q.length);
        // a typo is a missing, swapped or wrong letter; extra letters only count in longer words
        if (max && w[0] === q[0] && (q.length <= w.length || q.length >= 7)) {
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

/**
 * Timetable room codes like "Ma101", "MA 101", "ma.101", "MS 2.03" or "Fi-G12" resolve to the
 * building with that prefix. Only the building is known: where the room is inside isn't.
 * Returns the place and the code written the usual way ("Ma101", "MS2.03").
 */
export function parseRoom(raw: string, places: Place[]): { place: Place; code: string } | null {
  const m = raw.trim().match(/^([A-Za-z]{1,4})[\s\-.]*(\d[\w.]*|[A-Za-z]?\d[\w.]*)$/);
  if (!m) return null;
  const [, letters, rest] = m;
  let best: { place: Place; prefix: string; exact: boolean } | null = null;
  for (const p of places) {
    for (const prefix of p.roomCodePrefixes) {
      if (letters.toLowerCase() !== prefix.toLowerCase()) continue;
      // the exact case wins (Ma vs MS), then the longer prefix
      const exact = letters === prefix;
      if (!best || (exact && !best.exact) || (exact === best.exact && prefix.length > best.prefix.length)) best = { place: p, prefix, exact };
    }
  }
  return best ? { place: best.place, code: best.prefix + rest.toUpperCase() } : null;
}

function roomMatch(raw: string, places: Place[]): Hit | null {
  const r = parseRoom(raw, places);
  return r ? { place: r.place, score: 1.2, via: `Room ${r.code}`, room: r.code } : null;
}

export function search(raw: string, places: Place[], limit = 8): Hit[] {
  const q0 = norm(raw);
  if (!q0) return [];
  const hits = new Map<string, Hit>();
  let weight = 1;
  const add = (h: Hit) => {
    h = { ...h, score: h.score * weight };
    const prev = hits.get(h.place.id);
    if (!prev || h.score > prev.score) hits.set(h.place.id, h);
  };

  const room = roomMatch(raw, places);
  if (room) add(room);

  // the words as typed, then each everyday synonym a little lower
  for (const q of [q0, ...variants(q0)]) {
  weight = q === q0 ? 1 : 0.85;
  for (const p of places) {
    if (p.code && norm(p.code) === q) add({ place: p, score: 1.1, via: `Code ${p.code}` });
    const name = norm(p.name) === q ? 1.3 : textScore(q, p.name);
    if (name) add({ place: p, score: name });
    for (const a of p.aliases) {
      // an alias typed in full (e.g. "QB054" for the prayer rooms) beats the room-code rule
      const s = norm(a) === q && q.length >= 4 ? 1.25 : textScore(q, a) * 0.9;
      if (s) add({ place: p, score: s, via: a });
    }
    // services and tags, then the description: lower, and every query word must start a word
    // there (or share its stem), so "shop" doesn't find "workshop"
    const every = (text: string) => { const words = norm(text).split(' '); return q.split(' ').every((w) => words.some((x) => wordHit(w, x))); };
    if (q.length >= 3) {
      for (const sv of p.services ?? []) if (every(sv)) add({ place: p, score: 0.6, via: sv });
      for (const t of p.tags ?? []) if (every(t)) add({ place: p, score: 0.58, via: t[0].toUpperCase() + t.slice(1) });
      if (every(p.description)) add({ place: p, score: 0.45 });
    }
  }
  }
  return [...hits.values()]
    // ties: entrances last, then the shorter (closer) name, so "libary" → Library before Library Café
    .sort((a, b) => b.score - a.score
      || Number(a.place.category === 'entrance') - Number(b.place.category === 'entrance')
      || a.place.name.length - b.place.name.length)
    .slice(0, limit);
}

/** Words that should offer "show all …" for a category. */
const GROUP_WORDS: Record<string, string[]> = {
  academic: ['academic', 'teaching', 'lecture', 'classroom', 'school'],
  library: ['library', 'study', 'books', 'study space', 'revision'],
  food: ['food', 'drink', 'cafe', 'cafes', 'coffee', 'restaurant', 'eat', 'lunch', 'breakfast', 'dinner', 'bar', 'diner', 'snack', 'shop'],
  accommodation: ['accommodation', 'halls', 'hall', 'residence', 'housing'],
  sport: ['sport', 'sports', 'gym', 'fitness', 'exercise', 'court'],
  services: ['services', 'support', 'help', 'wellbeing', 'careers', 'security', 'health', 'doctor', 'gp', 'laundry', 'union', 'finance'],
  faith: ['faith', 'prayer', 'pray', 'chapel', 'chaplaincy', 'mosque', 'wudu', 'multifaith'],
  outdoors: ['outdoors', 'outdoor', 'outside', 'parking', 'car park', 'garden', 'fountain', 'square'],
  nearby: ['nearby', 'bus', 'buses', 'bus stop', 'supermarket', 'groceries', 'off campus'],
};

export function matchingGroups(raw: string): string[] {
  const q = norm(raw);
  if (q.length < 2) return [];
  return Object.entries(GROUP_WORDS)
    .filter(([, words]) => words.some((w) => w === q || (q.length >= 3 && w.startsWith(q))))
    .map(([g]) => g);
}
