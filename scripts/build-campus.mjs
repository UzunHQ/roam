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
// same outline, so a tap picked the whole block. Cut it in half along its length: the west half,
// on the library side, is Elm Grove; the east half, towards Lee House, is Elm Grove Hall.
const SPLITS = [{ west: 'relation/8673531', east: 'relation/8673532' }];
function halves(ringLLIn) {
  const pts = ringLLIn.slice(0, -1).map(toM);
  const c = pts.reduce(([x, y], p) => [x + p[0] / pts.length, y + p[1] / pts.length], [0, 0]);
  // long axis: the main direction of the corners (principal component)
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - c[0]) ** 2; syy += (y - c[1]) ** 2; sxy += (x - c[0]) * (y - c[1]); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), nrm = [-Math.sin(ang), Math.cos(ang)];
  const side = (p) => (p[0] - c[0]) * nrm[0] + (p[1] - c[1]) * nrm[1];
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
  const mean = (r) => r.reduce((s, p) => s + p[0], 0) / r.length;
  return (mean(a) < mean(b) ? [a, b] : [b, a]).map(ringLL); // [west, east]
}
for (const { west, east } of SPLITS) {
  const w = buildings.find((b) => b.f.properties.osmId === west), e = buildings.find((b) => b.f.properties.osmId === east);
  if (!w || !e) { console.warn(`split ${west} / ${east}: not found`); continue; }
  const [rw, re] = halves(w.ring);
  for (const [b, r] of [[w, rw], [e, re]]) { b.ring = r; b.f.geometry.coordinates = [r]; }
  console.log(`split ${west} (west, centre ${JSON.stringify(centroid(rw))}) / ${east} (east, centre ${JSON.stringify(centroid(re))})`);
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
const POINT_ONLY_IDS = new Set(['convent-parlour', 'digby-square']);
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
// campus tour and the aerial view; the aisles cars park off are OSM ways.
// a stable pseudo-random number in [0, 1) for a few integers
const hash = (...n) => { const v = Math.sin(n.reduce((a, b, i) => a + b * (12.9898 + i * 78.233), 0)) * 43758.5453; return v - Math.floor(v); };
const wayGeom = new Map(osm.elements.filter((el) => el.type === 'way' && el.geometry).map((el) => [el.id, el.geometry.map((p) => [p.lon, p.lat])]));

const PARKING = [
  { // between Davies Sports Hall and the MUGA, on the south side of the service road
    place: 'south-car-park', aisles: [293959905],
    area: [[-107.9, 4.6], [-123.7, 6.7], [-139.6, 8.7], [-140.3, 3.2], [-124.5, 1.1], [-108.6, -1.0]],
  },
  { // the long strip between Queen's Building's east front and the wall, short aisles off the service road
    place: 'southlands-car-park', aisles: [1216692135, 1216692136, 1216692137, 1216692138],
    area: [[167.5, 415.5], [188.7, 415.5], [176.3, 496], [156, 496], [155.5, 489.5], [161, 441], [163.5, 437.5], [166, 417.5]],
  },
  { // south of Grove House, just below the road
    place: 'froebel-car-park', aisles: [259754248],
    area: [[36.3, -66.5], [8.4, -61.3], [3.9, -62], [-3.9, -64.5], [-2.2, -69.8], [5.6, -67.4], [9.4, -67.2], [33.3, -71.6]],
  },
];
// parked cars: low-poly boxes drawn in the app (map.ts); about 60% of the bays are taken
const CAR = { long: 4.3, wide: 1.8, pitch: 2.6, aisleHalf: 3, colours: 6 };
const noTrees = []; // rings (lng/lat) where no decorative tree should stand
let cars = 0;
PARKING.forEach((lot, li) => {
  const area = ringLL(lot.area);
  noTrees.push(area);
  features.push({ type: 'Feature', properties: { layer: 'parking', place: lot.place }, geometry: { type: 'Polygon', coordinates: [area] } });
  const bays = [];
  for (const id of lot.aisles) {
    const pts = (wayGeom.get(id) ?? []).map(toM);
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
          if (bays.some((b) => Math.hypot(b[0] - c[0], b[1] - c[1]) < CAR.pitch - 0.2)) continue; // aisle bends
          bays.push(c);
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
console.log(`generated ${trees} decorative trees (${cleared} left out of courts, fields and car parks)`);

const fc = { type: 'FeatureCollection', generated: new Date().toISOString().slice(0, 10), attribution: '© OpenStreetMap contributors (ODbL)', bounds: placesDoc.bounds, features };
await writeFile(OUT, JSON.stringify(fc));
await writeFile(PLACES, JSON.stringify(placesDoc, null, 2) + '\n');
await writeFile(UNMATCHED, report.filter((l) => !l.startsWith('OK')).join('\n') + '\n');

const count = (l) => features.filter((f) => f.properties.layer === l).length;
console.log(`campus.geojson: ${count('building')} buildings, ${count('path')} paths, ${count('green')} green, ${count('water')} water, ${count('pitch')} pitches, ${count('tree')} trees`);
console.log(report.join('\n'));
