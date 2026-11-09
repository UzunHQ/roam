// npm run check:data: the place list's own rules, checked on every change (and in CI).
//   - every record has the fields the app reads, with sane values
//   - no two records share an id or a name
//   - every pin stands on the map: inside the island's outline (layer "contextzone" in
//     data/campus.geojson), so none floats over empty ground
//   - outside the university's own sites (no college, not an entrance) only the places the owner
//     chose: data/allowed-offcampus.json
//   - an alias belongs to its own record: no alias that is another record's name, and none that
//     names something the owner removed (shops and schools beside the campus)
//   - each record says where it came from (a source with a checked date) or is marked unchecked
// Exits 1 with a list of problems, 0 when clean.
import fs from 'node:fs';

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const doc = read('data/places.json');
const campus = read('data/campus.geojson');
const allowed = new Set(read('data/allowed-offcampus.json').ids);
const places = doc.places;
const problems = [];
const bad = (id, msg) => problems.push(`${id}: ${msg}`);

// ---------- fields ----------
const CATEGORIES = new Set(['building', 'food', 'sport', 'entrance', 'nearby']);
const COLLEGES = new Set(['digby-stuart', 'froebel', 'southlands', 'whitelands', null]);
for (const p of places) {
  const id = p.id ?? '(no id)';
  if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) bad(id, 'id must be lower-case letters, digits and dashes');
  if (typeof p.name !== 'string' || !p.name.trim()) bad(id, 'no name');
  if (!CATEGORIES.has(p.category)) bad(id, `unknown category "${p.category}"`);
  if (!COLLEGES.has(p.college ?? null)) bad(id, `unknown college "${p.college}"`);
  if (!Array.isArray(p.position) || p.position.length !== 2 || !p.position.every(Number.isFinite)) bad(id, 'position must be [lng, lat]');
  if (p.aliases !== undefined && !Array.isArray(p.aliases)) bad(id, 'aliases must be a list');
}

// ---------- duplicates ----------
const seen = new Map();
for (const p of places) {
  for (const [k, v] of [['id', p.id], ['name', String(p.name).trim().toLowerCase()]]) {
    const key = `${k}:${v}`;
    if (seen.has(key)) bad(p.id, `same ${k} as ${seen.get(key)}`);
    else seen.set(key, p.id);
  }
}

// ---------- on the map ----------
const zone = campus.features.find((f) => f.properties?.layer === 'contextzone');
if (!zone) problems.push('campus.geojson: no "contextzone" outline to check pins against');
const polys = zone ? (zone.geometry.type === 'MultiPolygon' ? zone.geometry.coordinates : [zone.geometry.coordinates]) : [];
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const onMap = (pt) => polys.some(([outer, ...holes]) => inRing(pt, outer) && !holes.some((h) => inRing(pt, h)));
for (const p of places) {
  if (p.noPin || p.outsideMap || !Array.isArray(p.position)) continue;
  if (polys.length && !onMap(p.position)) bad(p.id, `pin at ${p.position.join(', ')} is outside the map's island`);
}

// ---------- outside the campus: only the owner's choices ----------
for (const p of places) {
  if ((p.college ?? null) === null && p.category !== 'entrance' && !allowed.has(p.id)) {
    bad(p.id, 'off-campus place not in data/allowed-offcampus.json (the owner has to ask for it by name)');
  }
}
for (const id of allowed) if (!places.some((p) => p.id === id)) problems.push(`allowed-offcampus.json: "${id}" has no record (remove it from the list)`);

// ---------- aliases ----------
const names = new Map(places.map((p) => [p.name.trim().toLowerCase(), p.id]));
const REMOVED = ['premier', 'cafe joy', 'launderette', 'mosaic', 'ibstock', 'eastwood', 'roehampton house', 'londis', 'waitrose'];
for (const p of places) {
  for (const a of p.aliases ?? []) {
    const k = String(a).trim().toLowerCase();
    const owner = names.get(k);
    if (owner && owner !== p.id) bad(p.id, `alias "${a}" is ${owner}'s name`);
    if (REMOVED.some((r) => k.includes(r))) bad(p.id, `alias "${a}" names a place the owner removed`);
  }
}

// ---------- sources ----------
for (const p of places) {
  const sources = p.sources ?? [];
  const dated = sources.some((s) => s && (s.checked || s.url));
  if (!dated && !p.lastVerified && p.status !== 'unverified' && p.positionSource == null) bad(p.id, 'no source (add one with a checked date, or mark status "unverified")');
}

if (problems.length) {
  console.error(`check:data found ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`check:data: ${places.length} places, all on the map; ${allowed.size} off-campus places, all chosen by the owner.`);
