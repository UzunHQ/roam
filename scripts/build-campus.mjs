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
const POINT_ONLY_KINDS = new Set(['court', 'field', 'parking', 'fountain', 'garden', 'square']);
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
      .filter((b) => minScore === 1 || !claimed.has(b.f.properties.osmId))
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
      .filter((b) => !claimed.has(b.f.properties.osmId))
      .map((b) => ({ b, score: nameScore(p, b.f.properties.name), d: distToRing(p.position, b.ring) }))
      .filter((x) => x.score >= 0.5 && x.d < radius)
      .sort((a, b) => b.score - a.score || a.d - b.d)[0];
    if (partial) { match = partial; how = `partial name "${partial.b.f.properties.name}"`; }
  }
  // 2) otherwise the nearest footprint within the position accuracy
  if (!match) {
    const limit = Math.max(15, p.positionAccuracyM || 20);
    const near = buildings.map((b) => ({ b, d: distToRing(p.position, b.ring) })).sort((a, b) => a.d - b.d)[0];
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
for (const { f, ring: r } of buildings) {
  if (f.properties.college) continue;
  const c = centroid(r);
  f.properties.campus = !campusRings.length || campusRings.some((cr) => pointInRing(c, cr));
  if (!f.properties.campus) { f.properties.college = null; continue; }
  let best = null, bd = Infinity;
  for (const p of withCollege) { const d = metres(c, p.position); if (d < bd) { bd = d; best = p; } }
  f.properties.college = best && bd < 150 ? best.college : null;
}
console.log(`university outlines: ${campusRings.length}`);
for (const { f } of buildings) {
  f.properties.campus ??= true;
}

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
const noTrees = []; // rings (lng/lat) where no decorative tree should stand
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
// Markings like a small games court: outline, halfway line, centre circle and a box at each end.
{
  const q = features.find((f) => f.id === 'way/1546333126')?.geometry.coordinates[0].slice(0, 4).map(toM);
  if (q) {
    const c = q.reduce(([x, y], p) => [x + p[0] / 4, y + p[1] / 4], [0, 0]);
    const e0 = [q[1][0] - q[0][0], q[1][1] - q[0][1]], e1 = [q[2][0] - q[1][0], q[2][1] - q[1][1]];
    const [lg, sh] = Math.hypot(...e0) > Math.hypot(...e1) ? [e0, e1] : [e1, e0];
    const L = Math.hypot(...lg), W = Math.hypot(...sh), u = [lg[0] / L, lg[1] / L], v = [-u[1], u[0]];
    const at = (x, y) => fromM([c[0] + v[0] * x + u[0] * y, c[1] + v[1] * x + u[1] * y]);
    const line = (pts) => features.push({ type: 'Feature', properties: { layer: 'courtline', court: 'cage' }, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => at(x, y)) } });
    const w = W / 2 - 0.8, l = L / 2 - 0.8;
    line([[-w, -l], [w, -l], [w, l], [-w, l], [-w, -l]]);
    line([[-w, 0], [w, 0]]);
    line(Array.from({ length: 33 }, (_, k) => [3 * Math.cos((k * Math.PI) / 16), 3 * Math.sin((k * Math.PI) / 16)]));
    for (const end of [-1, 1]) line([[-3.5, end * l], [-3.5, end * (l - 4)], [3.5, end * (l - 4)], [3.5, end * l]]);
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
  const hullPts = [...wallLines.flat(), ...placesDoc.places.filter((p) => p.category !== 'entrance').map((p) => toM(p.position))];
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
  if (meadowF) meadowF.properties.unveil = true; // runs past the map's edge: the app keeps it out of the dimmed frame
  const meadow = meadowF?.geometry.coordinates[0];
  let seed3 = 11, more = 0;
  const rand3 = () => ((seed3 = (seed3 * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const M = 12; // metres between candidates
  for (let y = y0 + M / 2; meadow && y < y1; y += M) {
    for (let x = x0 + M / 2; x < x1; x += M) {
      const keep = rand3() < 0.5, jx = (rand3() - 0.5) * M * 0.8, jy = (rand3() - 0.5) * M * 0.8, size = Math.round((0.75 + rand3() * 0.6) * 100) / 100;
      if (!keep) continue;
      const m = [x + jx, y + jy], ll = fromM(m);
      if (!pointInRing(ll, meadow)) continue;
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

const fc = { type: 'FeatureCollection', generated: new Date().toISOString().slice(0, 10), attribution: '© OpenStreetMap contributors (ODbL)', bounds: placesDoc.bounds, features };
await writeFile(OUT, JSON.stringify(fc));
await writeFile(PLACES, JSON.stringify(placesDoc, null, 2) + '\n');
await writeFile(UNMATCHED, report.filter((l) => !l.startsWith('OK')).join('\n') + '\n');

const count = (l) => features.filter((f) => f.properties.layer === l).length;
console.log(`campus.geojson: ${count('building')} buildings, ${count('path')} paths, ${count('green')} green, ${count('water')} water, ${count('pitch')} pitches, ${count('tree')} trees`);
console.log(report.join('\n'));
