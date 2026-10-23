// Builds data/campus.geojson once from OpenStreetMap (Overpass API) and snaps
// places in data/places.json to OSM building footprints.
// Run: npm run build:campus   (the app itself never calls Overpass)
// Flags: --cache  reuse scripts/.overpass-cache.json instead of downloading
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const PLACES = new URL('data/places.json', ROOT);
const OUT = new URL('data/campus.geojson', ROOT);
const CACHE = new URL('scripts/.overpass-cache.json', ROOT);
const UNMATCHED = new URL('data/unmatched.txt', ROOT);

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const placesDoc = JSON.parse(await readFile(PLACES, 'utf8'));
const [w, s, e, n] = placesDoc.bounds;
const bbox = `${s},${w},${n},${e}`;

const query = `[out:json][timeout:90];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["highway"](${bbox});
  way["leisure"](${bbox});
  way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery)$"](${bbox});
  way["natural"~"^(water|wood|scrub|grassland)$"](${bbox});
  relation["natural"="water"](${bbox});
  way["waterway"](${bbox});
  node["natural"="tree"](${bbox});
  way["amenity"="university"](${bbox});
  way["golf"](${s - 0.002},${w - 0.003},${n + 0.004},${e});
  relation["amenity"="university"](${bbox});
);
out body geom;`;

async function download() {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Roam-campus-map-build/1.0 (unofficial student project)',
          Accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`Overpass ${url} failed: ${err.message}`);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

const useCache = process.argv.includes('--cache') && existsSync(CACHE);
const osm = useCache ? JSON.parse(await readFile(CACHE, 'utf8')) : await download();
if (!useCache) await writeFile(CACHE, JSON.stringify(osm));

// ---------- geometry helpers ----------
const ring = (geom) => geom.map((p) => [round(p.lon), round(p.lat)]);
const round = (v) => Math.round(v * 1e7) / 1e7;
const closed = (r) => r.length > 3 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1];

function metres([lng1, lat1], [lng2, lat2]) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pointInRing([x, y], r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// distance from point to polygon edge in metres (0 if inside)
function distToRing(p, r) {
  if (pointInRing(p, r)) return 0;
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0; i < r.length - 1; i++) {
    const ax = r[i][0] * k, ay = r[i][1], bx = r[i + 1][0] * k, by = r[i + 1][1];
    const px = p[0] * k, py = p[1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const q = [(ax + t * dx) / k, ay + t * dy];
    best = Math.min(best, metres(p, q));
  }
  return best;
}

// local metres east/north of ORIGIN, for shapes drawn by hand
const ORIGIN = [-0.246, 51.4555];
const KX = 111320 * Math.cos((ORIGIN[1] * Math.PI) / 180), KY = 111320;
const fromM = ([x, y]) => [round(ORIGIN[0] + x / KX), round(ORIGIN[1] + y / KY)];
const toM = ([lng, lat]) => [(lng - ORIGIN[0]) * KX, (lat - ORIGIN[1]) * KY];
const ringLL = (pts) => [...pts, pts[0]].map(fromM);

function centroid(r) {
  let x = 0, y = 0;
  const m = r.length - 1;
  for (let i = 0; i < m; i++) { x += r[i][0]; y += r[i][1]; }
  return [round(x / m), round(y / m)];
}

// ---------- convert OSM -> features ----------
const features = [];
const buildings = [];
const campusRings = []; // OSM amenity=university outlines

function heightOf(tags) {
  if (tags.height) return parseFloat(tags.height) || null;
  if (tags['building:levels']) return (parseFloat(tags['building:levels']) || 2) * 3.2;
  return null;
}

for (const el of osm.elements) {
  const t = el.tags || {};
  if (el.type === 'node' && t.natural === 'tree') {
    features.push({ type: 'Feature', id: `node/${el.id}`, properties: { layer: 'tree' }, geometry: { type: 'Point', coordinates: [round(el.lon), round(el.lat)] } });
    continue;
  }
  let rings = [];
  if (el.type === 'way' && el.geometry) rings = [ring(el.geometry)];
  else if (el.type === 'relation' && el.members) {
    rings = el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => ring(m.geometry)).filter(closed);
  }
  if (!rings.length) continue;
  const id = `${el.type}/${el.id}`;

  if (t.amenity === 'university' && !t.building) {
    for (const r of rings) if (closed(r)) campusRings.push(r);
    continue;
  }
  if (t.building) {
    for (const r of rings) {
      if (!closed(r)) continue;
      const f = {
        type: 'Feature', id,
        properties: { layer: 'building', osmId: id, name: t.name || null, building: t.building, height: heightOf(t) },
        geometry: { type: 'Polygon', coordinates: [r] },
      };
      features.push(f);
      buildings.push({ f, ring: r });
    }
  } else if (t.highway) {
    const kind = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track'].includes(t.highway) ? 'footpath'
      : ['service', 'living_street'].includes(t.highway) ? 'service' : 'road';
    features.push({ type: 'Feature', id, properties: { layer: 'path', kind, highway: t.highway, name: t.name || null }, geometry: { type: 'LineString', coordinates: rings[0] } });
  } else if (t.natural === 'water' || t.water || t.leisure === 'swimming_pool') {
    for (const r of rings) if (closed(r)) features.push({ type: 'Feature', id, properties: { layer: 'water' }, geometry: { type: 'Polygon', coordinates: [r] } });
  } else if (t.waterway) {
    features.push({ type: 'Feature', id, properties: { layer: 'waterway' }, geometry: { type: 'LineString', coordinates: rings[0] } });
  } else if (t.leisure === 'pitch' || t.leisure === 'sports_centre' || t.leisure === 'track') {
    for (const r of rings) if (closed(r)) features.push({ type: 'Feature', id, properties: { layer: 'pitch', sport: t.sport || null }, geometry: { type: 'Polygon', coordinates: [r] } });
  } else if (t.leisure || t.landuse || t.natural) {
    const wooded = t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub';
    for (const r of rings) if (closed(r)) features.push({ type: 'Feature', id, properties: { layer: 'green', wooded }, geometry: { type: 'Polygon', coordinates: [r] } });
  }
}

// ---------- buildings OSM has in the wrong place ----------
// The small unnamed block way/1094567673 stands just inside the wall by the main entrance, south of
// the drive in from the gate (seen on site), not 15 m further in by Elm Grove. Moved as it is:
// same outline, size and height. Metres east and north.
const MOVES = [{ osmId: 'way/1094567673', by: [13.25, 0.9] }];
for (const { osmId, by } of MOVES) {
  const b = buildings.find((x) => x.f.properties.osmId === osmId);
  if (!b) { console.warn(`move ${osmId}: not found`); continue; }
  const r = b.ring.map(toM).map(([x, y]) => fromM([x + by[0], y + by[1]]));
  b.ring = r;
  b.f.geometry.coordinates = [r];
  console.log(`moved ${osmId} by ${by.join(', ')} m`);
}

// ---------- historic monuments that are not university buildings ----------
// The Lyne-Stephens Mausoleum (Grade II, Historic England 1184736) is OSM's way/623548456: a small
// Romanesque mausoleum, Greek cross in plan, stone-faced, each arm under an equilateral gable. It is
// drawn by the app as low grey stone (layer "monument"), not as a campus building with windows and
// a college roof. Its outline stays in `buildings` only so decorative trees keep clear of it.
const MONUMENTS = [{ osmId: 'way/623548456', kind: 'mausoleum', wall: 3.5 }]; // wall height: an estimate, no source gives one
for (const m of MONUMENTS) {
  const b = buildings.find((x) => x.f.properties.osmId === m.osmId);
  if (!b) { console.warn(`monument ${m.osmId}: not found`); continue; }
  const pts = b.ring.slice(0, -1).map(toM);
  const c = pts.reduce(([x, y], p) => [x + p[0] / pts.length, y + p[1] / pts.length], [0, 0]);
  // the cross's axes: the direction of its longest straight edge (an arm's end)
  let best = 0, a = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > best) { best = l; a = Math.atan2(q[1] - p[1], q[0] - p[0]); } });
  const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
  const along = pts.map((p) => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1]), across = pts.map((p) => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]);
  const span = Math.round(Math.min(Math.max(...along) - Math.min(...along), Math.max(...across) - Math.min(...across)) * 10) / 10;
  b.f.properties = { layer: 'monument', osmId: m.osmId, name: b.f.properties.name, kind: m.kind, a: Math.round(a * 1000) / 1000, span, arm: Math.round(best * 10) / 10, wall: m.wall, centre: fromM(c) };
  b.monument = true;
  console.log(`monument ${m.osmId}: ${m.kind}, span ${span} m, arm ${b.f.properties.arm} m`);
}

// ---------- one block that OSM maps as two buildings ----------
// Elm Grove (careers, conference centre) and Elm Grove Hall (halls) are two relations with the
// same outline, so a tap picked the whole block. The block stays one building on the map; only
// selection is split, across the middle of its short side: the north half (library side) is
// Elm Grove, the south half is Elm Grove Hall. The halves (layer "half") carry the relation ids,
// so the app can tell which half was tapped, highlight just that half and route to it.
const SPLITS = [{ block: 'relation/8673532', north: { osmId: 'relation/8673531', place: 'elm-grove' }, south: { osmId: 'relation/8673532', place: 'elm-grove-hall' } }];
const forcedFootprint = new Map(); // place id -> half id
function halves(ringLLIn) {
  const pts = ringLLIn.slice(0, -1).map(toM);
  const c = pts.reduce(([x, y], p) => [x + p[0] / pts.length, y + p[1] / pts.length], [0, 0]);
  // long axis: the main direction of the corners (principal component); the cut is square to it
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - c[0]) ** 2; syy += (y - c[1]) ** 2; sxy += (x - c[0]) * (y - c[1]); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), u = [Math.cos(ang), Math.sin(ang)];
  const side = (p) => (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
  // keep one side of the cut line (Sutherland-Hodgman against a half-plane)
  const clip = (sign) => {
    const out = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length], sp = side(p) * sign, sq = side(q) * sign;
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    });
    return out;
  };
  const [a, b] = [clip(1), clip(-1)];
  const meanY = (r) => r.reduce((s, p) => s + p[1], 0) / r.length;
  return (meanY(a) > meanY(b) ? [a, b] : [b, a]).map(ringLL); // [north, south]
}
for (const { block, north, south } of SPLITS) {
  const whole = buildings.find((b) => b.f.properties.osmId === block);
  if (!whole) { console.warn(`split ${block}: not found`); continue; }
  const [rn, rs] = halves(whole.ring);
  const { height, building, college, campus } = whole.f.properties;
  for (const [half, r] of [[north, rn], [south, rs]]) {
    features.push({ type: 'Feature', properties: { layer: 'half', osmId: half.osmId, block, height, building, college, campus }, geometry: { type: 'Polygon', coordinates: [r] } });
    forcedFootprint.set(half.place, half.osmId);
    console.log(`half ${half.osmId} (${half === north ? 'north' : 'south'}, ${half.place}) centre ${JSON.stringify(centroid(r))}`);
  }
}

// ---------- snap places to footprints ----------
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'building', 'house', 'hall', 'centre', 'center', 'court', 'and', 'of', 'university', 'roehampton']);
const words = (s) => norm(s).split(' ').filter((x) => x.length > 1 && !STOP.has(x));

function nameScore(place, osmName) {
  if (!osmName) return 0;
  const on = norm(osmName);
  const names = [place.name, ...(place.aliases || [])].map(norm).filter(Boolean);
  if (names.includes(on)) return 1;
  const ow = new Set(words(osmName));
  let best = 0;
  for (const nm of [place.name, ...(place.aliases || [])]) {
    const pw = words(nm);
    if (!pw.length) continue;
    const hit = pw.filter((x) => ow.has(x)).length / pw.length;
    best = Math.max(best, hit * 0.9); // word overlap never counts as an exact match
  }
  return best;
}

const report = [];
const snapCategories = new Set(['building', 'sport', 'food']);
// outdoor places keep their point, and so do rooms whose building already has its own pin
const POINT_ONLY_KINDS = new Set(['court', 'field', 'pitch', 'parking', 'fountain', 'garden', 'square', 'monument', 'golf']);
const POINT_ONLY_IDS = new Set(['convent-parlour']);
const pointOnly = (p) => POINT_ONLY_KINDS.has(p.kind) || POINT_ONLY_IDS.has(p.id);
const candidates = placesDoc.places.filter((p) => snapCategories.has(p.category) && !pointOnly(p));
const claimed = new Set(); // footprints taken by an exact name match
const exact = new Map();
// pass 1: exact names claim footprints; pass 2: strong word overlap nearby, unclaimed only
for (const [minScore, maxD] of [[1, 250], [0.89, 60]]) {
  for (const p of candidates) {
    if (exact.has(p.id)) continue;
    const hit = buildings
      .filter((b) => !b.monument && (minScore === 1 || !claimed.has(b.f.properties.osmId)))
      .map((b) => ({ b, score: nameScore(p, b.f.properties.name), d: distToRing(p.position, b.ring) }))
      .filter((x) => x.score >= minScore && x.d < maxD)
      .sort((a, b) => a.d - b.d)[0];
    if (hit) { exact.set(p.id, hit); claimed.add(hit.b.f.properties.osmId); }
  }
}
for (const p of placesDoc.places) {
  if (pointOnly(p)) { p.footprintId = null; report.push(`--  ${p.id}: ${p.kind}, no building footprint (uses its point)`); continue; }
  if (!candidates.includes(p)) continue;
  const radius = Math.max(60, (p.positionAccuracyM || 20) * 3);
  let match = exact.get(p.id) || null, how = match ? `name "${match.b.f.properties.name}"` : '';
  // one half of a block that is split for selection (see SPLITS)
  if (forcedFootprint.has(p.id)) {
    const half = buildings.find((b) => b.f.properties.osmId === forcedFootprint.get(p.id));
    if (half) { match = { b: half }; how = 'name (split half)'; }
  }
  // 1) partial name match nearby, not stealing an exact-match footprint
  if (!match) {
    const partial = buildings
      .filter((b) => !b.monument && !claimed.has(b.f.properties.osmId))
      .map((b) => ({ b, score: nameScore(p, b.f.properties.name), d: distToRing(p.position, b.ring) }))
      .filter((x) => x.score >= 0.5 && x.d < radius)
      .sort((a, b) => b.score - a.score || a.d - b.d)[0];
    if (partial) { match = partial; how = `partial name "${partial.b.f.properties.name}"`; }
  }
  // 2) otherwise the nearest footprint within the position accuracy
  if (!match) {
    const limit = Math.max(15, p.positionAccuracyM || 20);
    const near = buildings.filter((b) => !b.monument).map((b) => ({ b, d: distToRing(p.position, b.ring) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= limit) {
      match = near;
      const nm = near.b.f.properties.name;
      how = (near.d === 0 ? 'point inside footprint' : `nearest, ${near.d.toFixed(0)} m away`) + (nm ? `; OSM calls it "${nm}", verify` : '');
    }
  }
  if (match) {
    p.footprintId = match.b.f.properties.osmId;
    match.b.f.properties.placeId ??= p.id;
    match.b.f.properties.college ??= p.college;
    if (p.status !== 'pending-legend') report.push(`${how.startsWith('name') ? 'OK ' : '~~ '} ${p.id} -> ${p.footprintId} (${how})`);
  } else {
    p.footprintId = null;
    if (p.status !== 'pending-legend') report.push(`??  ${p.id}: no footprint matched (accuracy ${p.positionAccuracyM} m)`);
  }
}

// college zone for unlinked footprints: nearest place's college within 120 m
const withCollege = placesDoc.places.filter((p) => p.college && p.category !== 'entrance');
for (const { f, ring: r, monument } of buildings) {
  if (monument || f.properties.college) continue;
  const c = centroid(r);
  f.properties.campus = !campusRings.length || campusRings.some((cr) => pointInRing(c, cr));
  if (!f.properties.campus) { f.properties.college = null; continue; }
  let best = null, bd = Infinity;
  for (const p of withCollege) { const d = metres(c, p.position); if (d < bd) { bd = d; best = p; } }
  f.properties.college = best && bd < 150 ? best.college : null;
}
console.log(`university outlines: ${campusRings.length}`);
for (const { f, monument } of buildings) {
  if (monument) continue;
  f.properties.campus ??= true;
}

// ---------- the golf course west of campus (Roehampton Club, OSM way/4268543) ----------
// Fairways, greens, tees, bunkers and rough inside the course become their own layer ("golf"),
// drawn under everything else; their playing surfaces are kept clear of decorative trees below.
// keep the part of a ring inside the map's bounds (Sutherland-Hodgman against the four sides)
function clipToBounds(r) {
  let pts = r.slice(0, -1);
  for (const [inside, cut] of [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ]) {
    const out = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      if (inside(p)) out.push(p);
      if (inside(p) !== inside(q)) out.push(cut(p, q).map(round));
    });
    pts = out;
    if (pts.length < 3) return null;
  }
  return [...pts, pts[0]];
}
const GOLF_KINDS = new Set(['fairway', 'green', 'tee', 'bunker', 'rough', 'water_hazard', 'lateral_water_hazard']);
const course = osm.elements.find((el) => el.type === 'way' && el.id === 4268543 && el.geometry);
const courseRing = course ? ring(course.geometry) : null;
const golfFeatures = [];
for (const el of osm.elements) {
  const kind = el.tags?.golf;
  if (!courseRing || el.type !== 'way' || !el.geometry || !GOLF_KINDS.has(kind)) continue;
  const whole = ring(el.geometry);
  if (!closed(whole) || !pointInRing(centroid(whole), courseRing)) continue;
  // the map stops at its bounds: the course is cut off there like everything else west and north
  const r = clipToBounds(whole);
  if (!r) continue;
  const f = { type: 'Feature', id: `way/${el.id}`, properties: { layer: 'golf', kind: kind.includes('water') ? 'water' : kind }, geometry: { type: 'Polygon', coordinates: [r] } };
  golfFeatures.push(f);
}
// rough first, then fairways, tees, greens, bunkers and water on top
const GOLF_ORDER = ['rough', 'fairway', 'tee', 'green', 'bunker', 'water'];
golfFeatures.sort((a, b) => GOLF_ORDER.indexOf(a.properties.kind) - GOLF_ORDER.indexOf(b.properties.kind));
features.push(...golfFeatures);
// a flag in the middle of each green on the map (drawn in the app)
for (const g of golfFeatures.filter((f) => f.properties.kind === 'green')) {
  const r = g.geometry.coordinates[0];
  features.push({ type: 'Feature', properties: { layer: 'golfflag' }, geometry: { type: 'Point', coordinates: centroid(r) } });
}
console.log(`golf: ${golfFeatures.length} areas (${GOLF_ORDER.map((k) => `${golfFeatures.filter((f) => f.properties.kind === k).length} ${k}`).join(', ')})`);

// ---------- hand-mapped outdoor areas ----------
// OSM has no car parks here. Shapes are in metres east/north of ORIGIN, traced against the
// campus tour and the aerial view; the aisles cars park off are OSM ways. A lot beside a road
// starts under its edge, so the asphalt runs on without a strip of grass.
// a stable pseudo-random number in [0, 1) for a few integers
const hash = (...n) => { const v = Math.sin(n.reduce((a, b, i) => a + b * (12.9898 + i * 78.233), 0)) * 43758.5453; return v - Math.floor(v); };
const wayGeom = new Map(osm.elements.filter((el) => el.type === 'way' && el.geometry).map((el) => [el.id, el.geometry.map((p) => [p.lon, p.lat])]));

const PARKING = [
  { // between Davies Sports Hall and the MUGA, on the south side of the service road
    place: 'south-car-park', aisles: [293959905],
    area: [[-107.7, 6.1], [-123.5, 8.2], [-139.4, 10.2], [-140.3, 3.2], [-124.5, 1.1], [-108.6, -1]],
  },
  { // the long strip between Queen's Building's east front and the wall, short aisles off the service road
    place: 'southlands-car-park', aisles: [1216692135, 1216692136, 1216692137, 1216692138],
    area: [[167.5, 415.5], [188.7, 415.5], [176.3, 496], [156, 496], [155.5, 489.5], [161, 441], [163.5, 437.5], [166, 417.5]],
  },
  { // south of Grove House: the whole block below the road, a drive down the middle with one row each side
    place: 'froebel-car-park', aisles: [],
    drive: [[-1.5, -73.3], [35.5, -80.7]],
    area: [[-0.8, -62.1], [7.1, -59.6], [40.6, -65.8], [33.4, -95.7], [-5.7, -90.2]],
  },
  { // north of Froebel Gate, inside the wall: the little loop at the end of the service road; one row
    // along its north side (the cars on the inner side would stand on the loop itself, so none are kept)
    place: 'froebel-gate-car-park', aisles: [], seed: 39, rows: [[[143, -75.7], [165.6, -79.3]]],
    area: [[144.2, -68.2], [166.8, -71.8], [168.6, -79.4], [168.3, -86.6], [164.9, -88.4], [142.8, -84.9], [140.6, -81.6], [141.2, -75.6]],
  },
  { // South Car Park's other side: the strip across the road, in front of Davies Sports Hall
    place: 'south-car-park', aisles: [293959905], seed: 5, // (seed: which bays are taken, about 60%)
    area: [[-107.7, 9.1], [-139.4, 13.2], [-138.6, 19.4], [-106.9, 15.2]],
  },
];
// parked cars: low-poly boxes drawn in the app (map.ts); about 60% of the bays are taken
const CAR = { long: 4.3, wide: 1.8, pitch: 2.6, aisleHalf: 3, colours: 6 };
// do two parked cars (corner lists) overlap? separating-axis test on their edges
const overlap = (a, b) => [a, b].every((poly) => poly.every((p, i) => {
  const q = poly[(i + 1) % poly.length], ax = [q[1] - p[1], p[0] - q[0]];
  const proj = (pts) => pts.map((r) => r[0] * ax[0] + r[1] * ax[1]);
  const pa = proj(a), pb = proj(b);
  return Math.max(...pa) > Math.min(...pb) + 1e-6 && Math.max(...pb) > Math.min(...pa) + 1e-6;
}));
// no car on a road (or within 1 m of a footpath): metres from a point to the nearest path of each kind
const pathSegs = features.filter((f) => f.properties.layer === 'path').map((f) => ({ road: f.properties.kind !== 'footpath', pts: f.geometry.coordinates.map(toM) }));
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const onPath = (corners) => pathSegs.some(({ road, pts }) => pts.some((a, i) => i < pts.length - 1 && corners.some((c) => segDist(c, a, pts[i + 1]) < (road ? 2.9 : 1.6))));
const noTrees = golfFeatures.filter((f) => f.properties.kind !== 'rough').map((f) => f.geometry.coordinates[0]); // rings (lng/lat) where no decorative tree should stand
let cars = 0;
PARKING.forEach((lot, i) => {
  const li = lot.seed ?? i;
  const area = ringLL(lot.area);
  noTrees.push(area);
  features.push({ type: 'Feature', properties: { layer: 'parking', place: lot.place }, geometry: { type: 'Polygon', coordinates: [area] } });
  const bays = [];
  for (const pts of [...lot.aisles.map((id) => (wayGeom.get(id) ?? []).map(toM)), ...(lot.drive ? [lot.drive] : []), ...(lot.rows ?? [])]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const u = [(bx - ax) / len, (by - ay) / len];
      for (let d = CAR.pitch / 2; d < len; d += CAR.pitch) {
        for (const side of [1, -1]) {
          // nose to the aisle: the car's long side is square to it
          const nrm = [-u[1] * side, u[0] * side], off = CAR.aisleHalf + CAR.long / 2;
          const c = [ax + u[0] * d + nrm[0] * off, ay + u[1] * d + nrm[1] * off];
          // (checked 0.25 m in, so a car whose nose meets the aisle edge still counts as inside)
          const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [
            c[0] + nrm[0] * (CAR.long / 2 - 0.25) * i + u[0] * (CAR.wide / 2) * j,
            c[1] + nrm[1] * (CAR.long / 2 - 0.25) * i + u[1] * (CAR.wide / 2) * j]);
          if (!corners.every((q) => pointInRing(q, lot.area))) continue;
          if (bays.some((b) => overlap(b, corners)) || onPath(corners)) continue; // aisle bends, rows meeting, roads
          bays.push(corners);
          const k = bays.length;
          if (hash(li, k, 1) > 0.6) continue;
          const a = Math.round((Math.atan2(nrm[1], nrm[0]) + (hash(li, k, 2) - 0.5) * 0.08) * 1000) / 1000;
          features.push({ type: 'Feature', properties: { layer: 'car', a, c: Math.floor(hash(li, k, 3) * CAR.colours) }, geometry: { type: 'Point', coordinates: fromM(c) } });
          cars++;
        }
      }
    }
  }
  const [cx, cy] = lot.area.reduce(([x, y], p) => [x + p[0] / lot.area.length, y + p[1] / lot.area.length], [0, 0]);
  console.log(`${lot.place}: ${bays.length} bays, centre ${JSON.stringify(fromM([cx, cy]))}`);
});
console.log(`parked ${cars} cars`);
// a lot's own drive is drawn like the campus service roads (after the cars, so they don't shy away from it)
for (const lot of PARKING) if (lot.drive) features.push({ type: 'Feature', properties: { layer: 'path', kind: 'service', drive: true }, geometry: { type: 'LineString', coordinates: lot.drive.map(fromM) } });

// the round lawn north of Grove House: a fountain in the middle of the circular path (the centre
// of its arc, fitted), and no decorative tree on the lawn inside the loop
const FOUNTAIN = [45.4, -0.1];
const loop = (wayGeom.get(293987530) ?? []).slice(0, 9); // the loop itself, without the path running on south
if (loop.length) noTrees.push([...loop, loop[0]].map(([x, y]) => [round(x), round(y)]));
features.push({ type: 'Feature', properties: { layer: 'fountain' }, geometry: { type: 'Point', coordinates: fromM(FOUNTAIN) } });
console.log(`fountain at ${JSON.stringify(fromM(FOUNTAIN))}`);

// the garden east of Grove House: a statue on a plinth in the middle, a low iron fence round it,
// and flower beds on the lawn around (drawn in map.ts); no decorative trees inside
const GARDEN = { area: [[54, -36.5], [85.5, -45.5], [80, -71], [50.5, -62]], statue: [66.6, -52.3] };
{
  noTrees.push(ringLL(GARDEN.area));
  const [a, b] = GARDEN.area;
  const angle = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) * 1000) / 1000; // along the garden's north edge
  features.push({ type: 'Feature', properties: { layer: 'statue', a: angle }, geometry: { type: 'Point', coordinates: fromM(GARDEN.statue) } });
  // beds: rectangles in the garden's own frame (u along the north edge, v across), clear of the fence
  const u = [Math.cos(angle), Math.sin(angle)], v = [-u[1], u[0]];
  const at = (x, y) => [GARDEN.statue[0] + u[0] * x + v[0] * y, GARDEN.statue[1] + u[1] * x + v[1] * y];
  // [x, y, half length, half width] in metres; the garden runs about -14..17 along u and -13..11 across
  const BEDS = [[-9.5, 6, 3.5, 2], [11, 6, 5, 2], [-9.5, -7, 3.5, 2], [11, -7, 5, 2], [0, 9, 4, 1.5], [0, -10.5, 4, 1.5], [-12, 0, 1, 3], [13.5, 0, 1.5, 3.5]];
  BEDS.forEach(([x, y, hx, hy], i) => {
    const ring = [[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy]].map(([p, q]) => at(p, q));
    if (!ring.every((p) => pointInRing(p, GARDEN.area))) { console.warn(`flower bed ${i} leaves the garden`); return; }
    features.push({ type: 'Feature', properties: { layer: 'flowerbed', c: i % 4 }, geometry: { type: 'Polygon', coordinates: [ringLL(ring)] } });
  });
}

// ---------- sports grounds ----------
// The MUGA's fenced courts and the big playing field west of Davies are grass in OSM
// (landuse=recreation_ground): draw them like pitches and keep decorative trees off them.
const FIELDS = new Set(['way/293961403', 'way/1546333125', 'way/653483624']);
// OSM's grass sprint track down the east side of the Playing Field isn't on the aerial view, and it
// would cross the east football pitch: leave it out
{ const i = features.findIndex((f) => f.id === 'way/1546333127'); if (i >= 0) features.splice(i, 1); }
for (const f of features) {
  if (f.properties.layer === 'green' && FIELDS.has(f.id)) f.properties.field = true;
  if (f.properties.layer === 'pitch' || f.properties.field) noTrees.push(f.geometry.coordinates[0]);
}
// the MUGA's courts sit inside a 3 m wire fence (OSM barrier=fence on the same outline)
const MUGA = features.find((f) => f.id === 'way/293961403');
if (MUGA) features.push({ type: 'Feature', properties: { layer: 'fence', height: 3 }, geometry: { type: 'LineString', coordinates: MUGA.geometry.coordinates[0] } });
// so does the small artificial-turf pitch west of the Playing Field
const CAGE = features.find((f) => f.id === 'way/653483624');
if (CAGE) features.push({ type: 'Feature', properties: { layer: 'fence', height: 3 }, geometry: { type: 'LineString', coordinates: CAGE.geometry.coordinates[0] } });
// tennis court markings on the MUGA's two tennis pitches; Court 1 is the western one
const TENNIS = { singles: 1.37, service: 6.4 };
const tennis = features.filter((f) => f.properties.layer === 'pitch' && f.properties.sport === 'tennis')
  .map((f) => f.geometry.coordinates[0].slice(0, 4).map(toM))
  .sort((a, b) => a.reduce((s, p) => s + p[0], 0) - b.reduce((s, p) => s + p[0], 0));
tennis.forEach((q, i) => {
  const c = q.reduce(([x, y], p) => [x + p[0] / 4, y + p[1] / 4], [0, 0]);
  const e0 = [q[1][0] - q[0][0], q[1][1] - q[0][1]], e1 = [q[2][0] - q[1][0], q[2][1] - q[1][1]];
  let [long, short] = Math.hypot(...e0) > Math.hypot(...e1) ? [e0, e1] : [e1, e0];
  if (long[1] < 0) long = [-long[0], -long[1]]; // u runs north: the numbers go at the north end, clear of the MUGA pin
  const L = Math.hypot(...long), W = Math.hypot(...short);
  const u = [long[0] / L, long[1] / L], v = [-u[1], u[0]];
  const at = (x, y) => fromM([c[0] + v[0] * x + u[0] * y, c[1] + v[1] * x + u[1] * y]);
  const line = (pts) => features.push({ type: 'Feature', properties: { layer: 'courtline', court: i + 1 }, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => at(x, y)) } });
  const w = W / 2, l = L / 2, sw = w - TENNIS.singles, sv = TENNIS.service;
  line([[-w, -l], [w, -l], [w, l], [-w, l], [-w, -l]]); // doubles outline
  line([[-sw, -l], [-sw, l]]); line([[sw, -l], [sw, l]]); // singles sidelines
  line([[-sw, -sv], [sw, -sv]]); line([[-sw, sv], [sw, sv]]); // service lines
  line([[0, -sv], [0, sv]]); // centre service line
  line([[-w - 0.4, 0], [w + 0.4, 0]]); // net
  features.push({ type: 'Feature', properties: { layer: 'courtlabel', name: `Court ${i + 1}` }, geometry: { type: 'Point', coordinates: at(0, l - 3.2) } });
});
console.log(`tennis courts marked: ${tennis.length}`);

// ---------- football pitches on the Playing Field ----------
// Two pitches side by side, long sides north-south, measured off the aerial view: a full-size one
// on the east, a smaller one west of it and a little further south. Lines and goals scale with
// each pitch. Local metres; `a` is the pitch's long axis (radians), along the field's east hedge.
const PITCHES = [
  { c: [-180, 27.5], long: 97, wide: 56 },
  { c: [-235.5, 20], long: 78, wide: 51 },
];
{
  const field = features.find((f) => f.id === 'way/1546333125')?.geometry.coordinates[0].map(toM);
  // the east hedge runs from its south-east corner to its north-east one
  const a = field ? Math.atan2(field[1][1] - field[2][1], field[1][0] - field[2][0]) : Math.PI / 2;
  const u = [Math.cos(a), Math.sin(a)], v = [u[1], -u[0]]; // u: up the pitch (north), v: across (east)
  for (const [i, P] of PITCHES.entries()) {
    const at = (x, y) => fromM([P.c[0] + v[0] * x + u[0] * y, P.c[1] + v[1] * x + u[1] * y]);
    const line = (pts) => features.push({ type: 'Feature', properties: { layer: 'courtline', pitch: i + 1 }, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => at(x, y)) } });
    const ring = (cx, cy, r, a0 = 0, a1 = 2 * Math.PI, n = 36) => Array.from({ length: n + 1 }, (_, k) => { const t = a0 + ((a1 - a0) * k) / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; });
    const w = P.wide / 2, l = P.long / 2, full = P.long >= 90;
    const box = (hw, d) => [[-hw, 0], [-hw, d], [hw, d], [hw, 0]];
    const pen = { hw: Math.min(20.15, w - 6), d: full ? 16.5 : 13 }, six = { hw: full ? 9.15 : 7.5, d: full ? 5.5 : 4.5 };
    const R = full ? 9.15 : 7.5, spot = full ? 11 : 9;
    line([[-w, -l], [w, -l], [w, l], [-w, l], [-w, -l]]); // touch and goal lines
    line([[-w, 0], [w, 0]]); // halfway line
    line(ring(0, 0, R)); // centre circle
    for (const end of [-1, 1]) {
      const flip = (pts) => pts.map(([x, d]) => [x, end * (l - d)]);
      line(flip(box(pen.hw, pen.d))); // penalty area
      line(flip(box(six.hw, six.d))); // goal area
      // the arc at the top of the penalty area: the part of a circle round the spot outside the box
      const t = Math.acos((pen.d - spot) / R);
      line(ring(0, 0, R, Math.PI / 2 - t, Math.PI / 2 + t, 12).map(([x, y]) => [x, end * (l - spot - y)]).map(([x, y]) => [x, y]));
      // the goal, standing on the goal line (drawn in the app)
      const g = fromM([P.c[0] + u[0] * end * l, P.c[1] + u[1] * end * l]);
      features.push({ type: 'Feature', properties: { layer: 'goal', a: Math.round(a * 1000) / 1000, w: full ? 7.32 : 5, h: full ? 2.44 : 2, back: end }, geometry: { type: 'Point', coordinates: g } });
    }
  }
  console.log(`football pitches marked: ${PITCHES.length}`);
}

// ---------- the small fenced pitch west of the Playing Field (way/1546333126) ----------
// A five-a-side football pitch (aerial view): touch and goal lines, halfway line, centre circle, a
// penalty arc in front of each goal and a small goal at each end. The wire fence round it stays.
{
  const q = features.find((f) => f.id === 'way/1546333126')?.geometry.coordinates[0].slice(0, 4).map(toM);
  if (q) {
    const c = q.reduce(([x, y], p) => [x + p[0] / 4, y + p[1] / 4], [0, 0]);
    const e0 = [q[1][0] - q[0][0], q[1][1] - q[0][1]], e1 = [q[2][0] - q[1][0], q[2][1] - q[1][1]];
    const [lg, sh] = Math.hypot(...e0) > Math.hypot(...e1) ? [e0, e1] : [e1, e0];
    const L = Math.hypot(...lg), W = Math.hypot(...sh), u = [lg[0] / L, lg[1] / L], v = [u[1], -u[0]];
    const at = (x, y) => fromM([c[0] + v[0] * x + u[0] * y, c[1] + v[1] * x + u[1] * y]);
    const line = (pts) => features.push({ type: 'Feature', properties: { layer: 'courtline', court: 'five-a-side' }, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => at(x, y)) } });
    const arc = (cx, cy, r, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, k) => { const t = a0 + ((a1 - a0) * k) / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; });
    const w = W / 2 - 0.8, l = L / 2 - 0.8, R = Math.min(5, w - 1);
    line([[-w, -l], [w, -l], [w, l], [-w, l], [-w, -l]]);
    line([[-w, 0], [w, 0]]);
    line(arc(0, 0, 2.5, 0, 2 * Math.PI, 32));
    for (const end of [-1, 1]) {
      // the penalty arc: a half circle on the goal line, bulging into the pitch
      line(arc(0, end * l, R, end > 0 ? Math.PI : 0, end > 0 ? 2 * Math.PI : Math.PI));
      features.push({ type: 'Feature', properties: { layer: 'goal', a: Math.round(Math.atan2(u[1], u[0]) * 1000) / 1000, w: 3, h: 2, back: end }, geometry: { type: 'Point', coordinates: at(0, end * l) } });
    }
    const pitchPlace = placesDoc.places.find((p) => p.id === 'five-a-side-pitch');
    if (pitchPlace) pitchPlace.position = fromM(c).map((x) => Math.round(x * 1e6) / 1e6);
    console.log(`five-a-side pitch: ${L.toFixed(1)} x ${W.toFixed(1)} m`);
  }
}

// ---------- low-poly trees: scatter deterministic points over green areas ----------
// (OSM maps very few individual trees here; these are decorative, flagged generated:true)
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const paths = features.filter((f) => f.properties.layer === 'path');
const nearPath = (p) => paths.some((f) => {
  const c = f.geometry.coordinates;
  for (let i = 0; i < c.length - 1; i++) if (distToRing(p, [c[i], c[i + 1]]) < 4) return true;
  return false;
});
const green = features.filter((f) => f.properties.layer === 'green');
let trees = 0, cleared = 0;
for (const g of green) {
  const r = g.geometry.coordinates[0];
  const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  const step = g.properties.wooded ? 10 : 22; // metres between candidates
  const dLat = step / 111320, dLng = step / (111320 * Math.cos((ys[0] * Math.PI) / 180));
  for (let y = Math.min(...ys); y < Math.max(...ys); y += dLat) {
    for (let x = Math.min(...xs); x < Math.max(...xs); x += dLng) {
      if (rand() < (g.properties.wooded ? 0.15 : 0.55)) continue;
      const p = [round(x + (rand() - 0.5) * dLng * 0.8), round(y + (rand() - 0.5) * dLat * 0.8)];
      if (p[0] < w || p[0] > e || p[1] < s || p[1] > n) continue;
      if (!pointInRing(p, r)) continue;
      if (buildings.some((b) => distToRing(p, b.ring) < 5)) continue;
      if (nearPath(p)) continue;
      const size = Math.round((0.75 + rand() * 0.6) * 100) / 100;
      // checked after the size is drawn, so the other trees keep their places and sizes
      if (noTrees.some((r) => distToRing(p, r) < 2)) { cleared++; continue; }
      features.push({ type: 'Feature', properties: { layer: 'tree', generated: true, s: size }, geometry: { type: 'Point', coordinates: p } });
      trees++;
    }
  }
}
console.log(`generated ${trees} decorative trees (${cleared} left out of courts, fields, car parks, the fountain lawn and the garden)`);

// ---------- gaps between OSM green areas ----------
// A wedge of plain ground east of the garden, between it and the woods towards the Medical Centre,
// showed as a pale patch; it is lawn on site, so it gets the same green.
const LAWN_FILLS = [[[84, -20], [104, -22], [110, -40], [104, -55], [101, -72], [88, -80], [80.5, -71], [86, -45.5]]];
for (const r of LAWN_FILLS) features.push({ type: 'Feature', properties: { layer: 'green', wooded: false, fill: true }, geometry: { type: 'Polygon', coordinates: [ringLL(r)] } });

// ---------- more trees on the open campus lawns ----------
// The lawns between buildings are plain background (no OSM green area), so the pass above never
// reaches them. A sparser scatter there, with its own seed so every tree above keeps its place.
// Kept off buildings, roads and paths, water, the campus wall and everything in noTrees.
{
  let seed2 = 7;
  const rand2 = () => ((seed2 = (seed2 * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const wallsDoc = JSON.parse(await readFile(new URL('data/walls.geojson', ROOT), 'utf8'));
  const wallLines = wallsDoc.features.filter((f) => f.geometry.type === 'LineString').map((f) => f.geometry.coordinates.map(toM));
  const water = features.filter((f) => f.properties.layer === 'water').map((f) => f.geometry.coordinates[0]);
  const roads = pathSegs.filter((p) => p.road), foot = pathSegs.filter((p) => !p.road);
  const near = (lines, p, d) => lines.some((pts) => pts.some((a, i) => i < pts.length - 1 && segDist(p, a, pts[i + 1]) < d));
  const outline = (b) => b.ring.map(toM);
  const bldg = buildings.map(outline);
  const treesM = features.filter((f) => f.properties.layer === 'tree').map((f) => toM(f.geometry.coordinates));
  // campus: OSM's university outlines leave out many lawns, so use the hull of the campus wall and
  // every place on campus instead (the wall is the edge on the Roehampton Lane and Clarence Lane sides)
  const hullPts = [...wallLines.flat(), ...placesDoc.places.filter((p) => p.category !== 'entrance' && p.college).map((p) => toM(p.position))]; // campus places only (not the golf course next door)
  const hull = (() => {
    const q = [...hullPts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of q) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
    for (const p of q.reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  })();
  // and the open OSM lawns and meadows around it (not woods, which are dense already, and not the playing fields)
  const lawns = features.filter((f) => f.properties.layer === 'green' && !f.properties.wooded && !f.properties.field).map((f) => f.geometry.coordinates[0]);
  const inCampus = (ll) => pointInRing(toM(ll), hull) || campusRings.some((r) => pointInRing(ll, r)) || lawns.some((r) => pointInRing(ll, r));
  const STEP = 19, KEEP = 0.42; // metres between candidates, share kept
  const [x0, y0] = toM([w, s]), [x1, y1] = toM([e, n]);
  let added = 0; const why = {};
  const no = (k) => { why[k] = (why[k] ?? 0) + 1; return true; };
  for (let y = y0 + STEP / 2; y < y1; y += STEP) {
    for (let x = x0 + STEP / 2; x < x1; x += STEP) {
      const keep = rand2() < KEEP, jx = (rand2() - 0.5) * STEP * 0.8, jy = (rand2() - 0.5) * STEP * 0.8, size = Math.round((0.75 + rand2() * 0.6) * 100) / 100;
      if (!keep) continue;
      const m = [x + jx, y + jy], ll = fromM(m);
      if (!inCampus(ll) && no('outside campus')) continue;
      if (noTrees.some((r) => pointInRing(ll, r) || distToRing(ll, r) < 2) && no('no-tree area')) continue;
      if (water.some((r) => pointInRing(ll, r) || distToRing(ll, r) < 3) && no('water')) continue;
      if (bldg.some((r) => pointInRing(m, r) || r.some((a, i) => i < r.length - 1 && segDist(m, a, r[i + 1]) < 6)) && no('building')) continue;
      if ((near(roads.map((r) => r.pts), m, 7) || near(foot.map((r) => r.pts), m, 4) || near(wallLines, m, 4)) && no('road, path or wall')) continue;
      if (treesM.some((t) => Math.hypot(t[0] - m[0], t[1] - m[1]) < 7) && no('next to a tree')) continue; // not crowding a tree already there
      features.push({ type: 'Feature', properties: { layer: 'tree', generated: true, s: size }, geometry: { type: 'Point', coordinates: ll } });
      treesM.push(m);
      added++;
    }
  }
  console.log(`added ${added} trees on open lawns; left out: ${JSON.stringify(why)}`);

  // the big meadow west of campus (OSM way/4268543): a denser scatter of its own, so it reads as
  // parkland like the grounds round the lake
  const meadowF = features.find((f) => f.id === 'way/4268543' && f.properties.layer === 'green');
  const meadow = meadowF?.geometry.coordinates[0];
  // It is Roehampton Club's golf course: trees stand in belts between the holes, thickest along the
  // edges of the fairways and greens, never on them (noTrees), and only inside the map's bounds.
  let seed3 = 11, more = 0;
  const rand3 = () => ((seed3 = (seed3 * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const M = 11; // metres between candidates
  const play = golfFeatures.filter((f) => ['fairway', 'green', 'tee'].includes(f.properties.kind)).map((f) => f.geometry.coordinates[0].map(toM));
  const toPlay = (m) => Math.min(Infinity, ...play.map((r) => r.reduce((d, a, i) => (i < r.length - 1 ? Math.min(d, segDist(m, a, r[i + 1])) : d), Infinity)));
  const mm = (meadow ?? []).map(toM), mx = mm.map((p) => p[0]), my = mm.map((p) => p[1]);
  // the course as far as the map's bounds go (beyond them it is plain meadow, no trees)
  const [gx0, gx1, gy0, gy1] = mm.length ? [Math.max(x0, Math.min(...mx)), Math.min(x1, Math.max(...mx)), Math.max(y0, Math.min(...my)), Math.min(y1, Math.max(...my))] : [0, 0, 0, 0];
  for (let y = gy0 + M / 2; meadow && y < gy1; y += M) {
    for (let x = gx0 + M / 2; x < gx1; x += M) {
      const r = rand3(), jx = (rand3() - 0.5) * M * 0.8, jy = (rand3() - 0.5) * M * 0.8, size = Math.round((0.75 + rand3() * 0.6) * 100) / 100;
      const m = [x + jx, y + jy], ll = fromM(m);
      if (!pointInRing(ll, meadow)) continue;
      const edge = play.length ? toPlay(m) : 99;
      if (r >= (edge < 14 ? 0.78 : edge < 30 ? 0.5 : 0.3)) continue; // thick along the holes, thinner further off
      if (noTrees.some((r) => pointInRing(ll, r) || distToRing(ll, r) < 2)) continue;
      if (water.some((r) => pointInRing(ll, r) || distToRing(ll, r) < 3)) continue;
      if (bldg.some((r) => pointInRing(m, r) || r.some((a, i) => i < r.length - 1 && segDist(m, a, r[i + 1]) < 6))) continue;
      if (near(roads.map((r) => r.pts), m, 7) || near(foot.map((r) => r.pts), m, 4) || near(wallLines, m, 4)) continue;
      if (treesM.some((t) => Math.hypot(t[0] - m[0], t[1] - m[1]) < 6)) continue;
      features.push({ type: 'Feature', properties: { layer: 'tree', generated: true, s: size }, geometry: { type: 'Point', coordinates: ll } });
      treesM.push(m);
      more++;
    }
  }
  console.log(`added ${more} trees on the west meadow`);

  // a wall of big, dark trees along the edge between the golf course and campus: from west of
  // Southlands, past Fincham, Digby and the lake, to the north-west corner of the Playing Field.
  // Three staggered rows just inside the course, clear of fairways, roads, paths, buildings and pitches.
  let belt = 0;
  if (courseRing) {
    const edge = [];
    // the course's east side, from where it enters the map in the north down past the Playing Field's
    // north-west corner and on south along its west side to the campus wall on Clarence Lane
    for (const p of courseRing.map(toM)) { if (p[1] > y1 + 1) { if (edge.length) break; continue; } edge.push(p); if (p[1] < -60) break; }
    let seed4 = 23;
    const rand4 = () => ((seed4 = (seed4 * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const courseM = courseRing.map(toM);
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i], b = edge[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      let nrm = [-u[1], u[0]];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (!pointInRing([mid[0] + nrm[0] * 3, mid[1] + nrm[1] * 3], courseM)) nrm = [-nrm[0], -nrm[1]]; // into the course
      for (let d = 0; d < len; d += 4.2) {
        for (const [row, off] of [[0, 3], [1, 7.5], [2, 12]]) {
          const jx = (rand4() - 0.5) * 2.4, jy = (rand4() - 0.5) * 2, size = Math.round((1.25 + rand4() * 0.5) * 100) / 100;
          const along = d + (row % 2) * 2.1 + jx;
          // a row slot in the course; where a tee, green or path takes it, the same slot on the campus
          // side of the edge instead, so the wall carries on unbroken
          for (const side of [1, -1]) {
            const o = side * (off + jy);
            const m = [a[0] + u[0] * along + nrm[0] * o, a[1] + u[1] * along + nrm[1] * o], ll = fromM(m);
            if (m[0] < x0 || m[0] > x1 || m[1] < y0 || m[1] > y1) continue;
            if (noTrees.some((r) => pointInRing(ll, r) || distToRing(ll, r) < 3)) continue;
            if (water.some((r) => pointInRing(ll, r) || distToRing(ll, r) < 3)) continue;
            if (bldg.some((r) => pointInRing(m, r) || r.some((p, k) => k < r.length - 1 && segDist(m, p, r[k + 1]) < 6))) continue;
            if (near(roads.map((r) => r.pts), m, 7) || near(foot.map((r) => r.pts), m, 4) || near(wallLines, m, 4)) continue;
            if (treesM.some((t) => Math.hypot(t[0] - m[0], t[1] - m[1]) < 3.2)) continue;
            features.push({ type: 'Feature', properties: { layer: 'tree', generated: true, s: size, belt: true }, geometry: { type: 'Point', coordinates: ll } });
            treesM.push(m);
            belt++;
            break;
          }
        }
      }
    }
  }
  console.log(`tree wall: ${belt} trees along the golf course edge`);

  // a few trees on the open lawn between the Student Medical Centre and the Lyne-Stephens Mausoleum
  // (hand-placed, metres; each is checked against paths, roads, buildings, car parks and the mausoleum)
  const LAWN_TREES = [[172, -30, 1.05], [182, -34, 0.9], [170, -40, 1.15], [178, -45, 1], [187, -42, 0.85], [168, -50, 0.95], [176, -54, 1.1]];
  const mausoleum = buildings.filter((b) => b.monument).map((b) => b.ring.map(toM));
  const lots = features.filter((f) => f.properties.layer === 'parking').map((f) => f.geometry.coordinates[0].map(toM));
  let lawnTrees = 0;
  for (const [x, y, size] of LAWN_TREES) {
    const m = [x, y];
    const clear = (rings, d) => !rings.some((r) => pointInRing(m, r) || r.some((p, k) => k < r.length - 1 && segDist(m, p, r[k + 1]) < d));
    if (!clear(bldg, 5) || !clear(mausoleum, 5) || !clear(lots, 3)) continue;
    if (near(roads.map((r) => r.pts), m, 6) || near(foot.map((r) => r.pts), m, 3.5)) continue;
    if (treesM.some((t) => Math.hypot(t[0] - m[0], t[1] - m[1]) < 5)) continue;
    features.push({ type: 'Feature', properties: { layer: 'tree', generated: true, s: size }, geometry: { type: 'Point', coordinates: fromM(m) } });
    treesM.push(m);
    lawnTrees++;
  }
  console.log(`lawn by the Medical Centre: ${lawnTrees} of ${LAWN_TREES.length} trees placed`);

  // the two open lawns east of Froebel (marked 4 and 5): east of the garden towards the drive, and
  // between the drive and the mausoleum. A loose scatter over each, with the same checks as above
  // plus the garden.
  const EAST_LAWNS = [
    { area: [[84, -46], [124, -46], [124, -74], [84, -74]] }, // 5
    { area: [[140, -40], [162, -40], [162, -72], [140, -72]] }, // 4
  ];
  const gardenM = GARDEN.area;
  let seed5 = 31, eastTrees = 0;
  const rand5 = () => ((seed5 = (seed5 * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (const { area } of EAST_LAWNS) {
    const xs = area.map((p) => p[0]), ys = area.map((p) => p[1]);
    for (let y = Math.min(...ys) + 3; y < Math.max(...ys); y += 7) {
      for (let x = Math.min(...xs) + 3; x < Math.max(...xs); x += 7) {
        const r = rand5(), jx = (rand5() - 0.5) * 4, jy = (rand5() - 0.5) * 4, size = Math.round((0.85 + rand5() * 0.4) * 100) / 100;
        if (r > 0.7) continue;
        const m = [x + jx, y + jy];
        const clear = (rings, d) => !rings.some((ring) => pointInRing(m, ring) || ring.some((p, k) => k < ring.length - 1 && segDist(m, p, ring[k + 1]) < d));
        if (!pointInRing(m, area) || pointInRing(m, gardenM) || !clear([gardenM.concat([gardenM[0]])], 3)) continue;
        if (!clear(bldg, 5) || !clear(mausoleum, 5) || !clear(lots, 3)) continue;
        if (near(roads.map((q) => q.pts), m, 6) || near(foot.map((q) => q.pts), m, 3.5)) continue;
        if (treesM.some((t) => Math.hypot(t[0] - m[0], t[1] - m[1]) < 5.5)) continue;
        features.push({ type: 'Feature', properties: { layer: 'tree', generated: true, s: size }, geometry: { type: 'Point', coordinates: fromM(m) } });
        treesM.push(m);
        eastTrees++;
      }
    }
  }
  console.log(`lawns east of Froebel: ${eastTrees} trees`);

  // and a lawn under the whole campus, below every other area (added last, so the trees above are
  // unchanged): ground OSM leaves unmapped between paths shows as grass, not as pale patches
  // (stretched over the west meadow and the playing field too, so no pale strip is left between them
  // and the campus: west of the Playing Field by Willow and Aspen House, and west of Southlands)
  const lawnPts = [...hullPts, ...[meadow, features.find((f) => f.id === 'way/1546333125')?.geometry.coordinates[0]].filter(Boolean).flat().map(toM)];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const sorted = [...lawnPts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), lo = [], hi = [];
  for (const p of sorted) { while (lo.length > 1 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of sorted.reverse()) { while (hi.length > 1 && cross(hi.at(-2), hi.at(-1), p) <= 0) hi.pop(); hi.push(p); }
  const lawn = [...lo.slice(0, -1), ...hi.slice(0, -1)];
  features.unshift({ type: 'Feature', properties: { layer: 'green', wooded: false, campus: true }, geometry: { type: 'Polygon', coordinates: [ringLL(lawn)] } });
}

// ---------- keep trees off the campus wall ----------
// Trees standing on the wall along Roehampton Lane and Clarence Lane, leaning over it, or just
// outside it, move straight in until their canopy clears the wall by a metre and they stand at
// least 3 m inside; where that spot is on a building, road or path, the tree goes.
{
  const wallDoc = JSON.parse(await readFile(new URL('data/walls.geojson', ROOT), 'utf8'));
  const segs = wallDoc.features.filter((f) => f.geometry.type === 'LineString').flatMap((f) => {
    const pts = f.geometry.coordinates.map(toM);
    return pts.slice(1).map((b, i) => [pts[i], b]);
  });
  const INSIDE = [-20, 160]; // the lake, well inside campus
  const side = (a, b, p) => Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const blds = buildings.map((b) => b.ring.map(toM));
  const pathPts = features.filter((f) => f.properties.layer === 'path').map((f) => ({ road: f.properties.kind !== 'footpath', pts: f.geometry.coordinates.map(toM) }));
  let moved = 0, removed = 0;
  // a few passes: near a corner, moving off one stretch of wall can bring a tree close to the next
  for (let pass = 0; pass < 3; pass++) for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.properties.layer !== 'tree') continue;
    const m = toM(f.geometry.coordinates);
    let best = null;
    for (const [a, b] of segs) { const d = segDist(m, a, b); if (!best || d < best.d) best = { d, a, b }; }
    if (!best) continue;
    const inward = side(best.a, best.b, m) === side(best.a, best.b, INSIDE);
    const signed = inward ? best.d : -best.d;
    const need = Math.max(3, 2.6 * (f.properties.s ?? 1) + 1); // canopy radius (map.ts treePolygons) plus a metre
    if (signed >= need || signed <= -12) continue;
    const { a, b } = best, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nrm = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    if (side(a, b, [a[0] + nrm[0], a[1] + nrm[1]]) !== side(a, b, INSIDE)) nrm = [-nrm[0], -nrm[1]];
    const to = [m[0] + nrm[0] * (need + 0.5 - signed), m[1] + nrm[1] * (need + 0.5 - signed)];
    const blocked = blds.some((r) => pointInRing(to, r) || r.some((p, k) => k < r.length - 1 && segDist(to, p, r[k + 1]) < 3))
      || pathPts.some(({ road, pts }) => pts.some((p, k) => k < pts.length - 1 && segDist(to, p, pts[k + 1]) < (road ? 5 : 2.5)));
    if (blocked) { features.splice(i, 1); removed++; continue; }
    f.geometry.coordinates = fromM(to);
    moved++;
  }
  console.log(`campus wall: ${moved} trees moved inside, ${removed} removed`);
}

// ---------- the map's own edge ----------
// The map ends at the campus and the strip of golf course beside it. West of the tree wall's far
// side and north of Southlands there is nothing to show: everything there is cut away, and the
// app dims it like the rest of the world outside the map (layer "mapedge"). Metres, a convex ring
// that holds every campus building, wall and place: its north-west side runs down the golf course
// from north of Southlands to the west end of the Clarence Lane wall, and its north side runs from
// the golf course just west of Southlands up to the wall's north-east corner (Southlands' buildings
// reach 532 m north, the wall 556 m) and back down east of Roehampton Lane.
const MAP_EDGE = [[-177, 497], [-244, 378], [-304, 244], [-360, 98], [-386, -67], [-386, -181], [296, -181], [296, 532], [166, 559]];
{
  const orient = Math.sign(MAP_EDGE.reduce((a, p, i) => { const q = MAP_EDGE[(i + 1) % MAP_EDGE.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0));
  const keepSide = (a, b, p) => orient * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
  const inEdge = (m) => MAP_EDGE.every((a, i) => keepSide(a, MAP_EDGE[(i + 1) % MAP_EDGE.length], m));
  // Sutherland-Hodgman against each side of the (convex) edge ring
  const clip = (ringLLIn) => {
    let pts = ringLLIn.slice(0, -1).map(toM);
    for (let i = 0; i < MAP_EDGE.length && pts.length; i++) {
      const a = MAP_EDGE[i], b = MAP_EDGE[(i + 1) % MAP_EDGE.length], out = [];
      pts.forEach((p, k) => {
        const q = pts[(k + 1) % pts.length], pin = keepSide(a, b, p), qin = keepSide(a, b, q);
        if (pin) out.push(p);
        if (pin !== qin) {
          const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
          const t = d1 / (d1 - d2);
          out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      });
      pts = out;
    }
    return pts.length >= 3 ? [...pts, pts[0]].map(fromM) : null;
  };
  let dropped = 0, cut = 0;
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i], layer = f.properties.layer;
    if (['tree', 'golfflag'].includes(layer)) {
      if (!inEdge(toM(f.geometry.coordinates))) { features.splice(i, 1); dropped++; }
    } else if (['green', 'golf'].includes(layer) && f.geometry.type === 'Polygon') {
      const r = f.geometry.coordinates[0];
      if (r.every((p) => inEdge(toM(p)))) continue;
      const c = clip(r);
      if (c) { f.geometry.coordinates = [c]; cut++; } else { features.splice(i, 1); dropped++; }
    }
  }
  features.push({ type: 'Feature', properties: { layer: 'mapedge' }, geometry: { type: 'Polygon', coordinates: [ringLL(MAP_EDGE)] } });
  // the golf course's pin: the middle of what is left of the course (area-weighted)
  const course = features.find((f) => f.id === 'way/4268543');
  const golfPlace = placesDoc.places.find((p) => p.id === 'roehampton-club-golf-course');
  if (course && golfPlace) {
    const r = course.geometry.coordinates[0].map(toM);
    let A = 0, cx = 0, cy = 0;
    r.forEach((p, k) => { if (k === r.length - 1) return; const q = r[k + 1], x = p[0] * q[1] - q[0] * p[1]; A += x; cx += (p[0] + q[0]) * x; cy += (p[1] + q[1]) * x; });
    golfPlace.position = fromM([cx / (3 * A), cy / (3 * A)]).map((v) => Math.round(v * 1e6) / 1e6);
  }
  console.log(`map edge: ${dropped} trees, flags and areas left out, ${cut} areas cut; golf pin at ${JSON.stringify(golfPlace?.position)}`);
}

const fc = { type: 'FeatureCollection', generated: new Date().toISOString().slice(0, 10), attribution: '© OpenStreetMap contributors (ODbL)', bounds: placesDoc.bounds, features };
await writeFile(OUT, JSON.stringify(fc));
await writeFile(PLACES, JSON.stringify(placesDoc, null, 2) + '\n');
await writeFile(UNMATCHED, report.filter((l) => !l.startsWith('OK')).join('\n') + '\n');

const count = (l) => features.filter((f) => f.properties.layer === l).length;
console.log(`campus.geojson: ${count('building')} buildings, ${count('path')} paths, ${count('green')} green, ${count('water')} water, ${count('pitch')} pitches, ${count('tree')} trees`);
console.log(report.join('\n'));
