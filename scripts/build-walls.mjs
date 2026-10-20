// Builds data/walls.geojson: the low stone wall along the campus's west edge (Clarence Lane) and
// east edge (Roehampton Lane), from OpenStreetMap. The app turns these lines into stone blocks.
// Run: npm run build:walls   (after build:campus, since it reads the paths and buildings)
// Flags: --cache  reuse scripts/.overpass-walls-cache.json instead of downloading
//
// Where the wall runs:
//  - Clarence Lane: the two barrier=wall ways mapped along it (the gap between them is the
//    Clarence Lane Gate).
//  - Roehampton Lane: no wall is mapped there, so it follows the university's boundary
//    (amenity=university) from its north-east corner down to the corner with Clarence Lane.
// The wall opens wherever a gate (barrier=gate/lift_gate) stands on it or a mapped path or road
// crosses it, with a stone pillar on each side. Where a building stands on the line, the
// building is the boundary and the wall stops against it.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('data/walls.geojson', ROOT);
const CACHE = new URL('scripts/.overpass-walls-cache.json', ROOT);
const CAMPUS = new URL('data/campus.geojson', ROOT);
const PLACES = new URL('data/places.json', ROOT);

const CLARENCE_WALLS = [1364116664, 1364116665]; // barrier=wall along Clarence Lane
const UNIVERSITY = 5904595; // amenity=university relation
const EAST_FROM = [-0.24365, 51.460497]; // boundary: north-east corner on Roehampton Lane
const EAST_TO = [-0.2437, 51.454223]; // ... to the corner with Clarence Lane (end of the wall above)

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const places = JSON.parse(await readFile(PLACES, 'utf8'));
const [w, s, e, n] = places.bounds;
const bbox = `${s - 0.001},${w - 0.002},${n + 0.001},${e + 0.002}`;
const query = `[out:json][timeout:60];
(
  way(id:${CLARENCE_WALLS.join(',')});
  relation(${UNIVERSITY});
  node["barrier"~"^(gate|lift_gate|kissing_gate|swing_gate)$"](${bbox});
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
const campus = JSON.parse(await readFile(CAMPUS, 'utf8'));

// ---------- local metres ----------
const LAT0 = 51.456, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 111320;
const xy = ([lng, lat]) => [lng * KX, lat * KY];
const ll = ([x, y]) => [Math.round((x / KX) * 1e7) / 1e7, Math.round((y / KY) * 1e7) / 1e7];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** distance from p to segment ab, and how far along ab (0..1) the nearest point is */
function toSeg(p, a, b) {
  const d = sub(b, a), L = d[0] * d[0] + d[1] * d[1];
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L)) : 0;
  return { dist: Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]), t };
}
function cross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  if (!(d1 * d2 < 0 && d3 * d4 < 0)) return null;
  return d3 / (d3 - d4); // along ab
}
/** drops points that bend the line by less than `tol` metres */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let max = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = toSeg(pts[i], pts[0], pts.at(-1)).dist;
    if (d > max) { max = d; at = i; }
  }
  if (max <= tol) return [pts[0], pts.at(-1)];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}
function pointInRing([x, y], r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- the wall lines ----------
const geom = (el) => el.geometry.map((p) => [p.lon, p.lat]);
const way = (id) => osm.elements.find((el) => el.type === 'way' && el.id === id);
const runs = [];
const [clarenceWest, clarenceEast] = CLARENCE_WALLS.map(way);
if (!clarenceWest || !clarenceEast) throw new Error('Clarence Lane wall ways not found in OSM');
runs.push({ name: 'Clarence Lane (west of the gate)', coords: geom(clarenceWest).reverse() });
runs.push({ name: 'Clarence Lane (east of the gate)', coords: geom(clarenceEast) });

const uni = osm.elements.find((el) => el.type === 'relation' && el.id === UNIVERSITY);
const ring = uni?.members.find((m) => m.role === 'outer' && m.geometry?.some((p) => same([p.lon, p.lat], EAST_FROM)));
if (!ring) throw new Error('University boundary along Roehampton Lane not found');
{
  const pts = ring.geometry.map((p) => [p.lon, p.lat]);
  const i = pts.findIndex((p) => same(p, EAST_FROM)), j = pts.findIndex((p) => same(p, EAST_TO));
  if (i < 0 || j < 0 || j <= i) throw new Error('Unexpected order of the university boundary');
  runs.push({ name: 'Roehampton Lane', coords: pts.slice(i, j + 1) });
}

// ---------- what opens or stops the wall ----------
const STEP = 0.25; // metres between samples along the wall
const buildings = campus.features.filter((f) => f.properties.layer === 'building' && f.geometry.type === 'Polygon').map((f) => f.geometry.coordinates[0].map(xy));
const paths = campus.features.filter((f) => f.properties.layer === 'path' && f.geometry.type === 'LineString');
const gates = osm.elements.filter((el) => el.type === 'node' && el.tags?.barrier);
const gateWidth = (t) => (t.barrier === 'lift_gate' ? 5 : (t.access === 'no' || t.motor_vehicle === 'no') && t.foot === 'yes' ? 2.5 : 4);
const pathWidth = { footpath: 3, service: 5.5, road: 7 };

const out = [];
const report = [];
for (const run of runs) {
  const pts = simplify(run.coords.map(xy), 0.4);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  const L = cum.at(-1);
  const at = (d) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const dirAt = (d) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const v = sub(pts[i], pts[i - 1]);
    return Math.atan2(v[1], v[0]);
  };
  /** projects a point onto the run: distance from the line, and position along it */
  const project = (p) => {
    let best = { dist: Infinity, along: 0 };
    for (let i = 1; i < pts.length; i++) {
      const r = toSeg(p, pts[i - 1], pts[i]);
      if (r.dist < best.dist) best = { dist: r.dist, along: cum[i - 1] + r.t * (cum[i] - cum[i - 1]) };
    }
    return best;
  };
  const gaps = []; // [from, to, why]
  for (const g of gates) {
    const p = project(xy([g.lon, g.lat]));
    if (p.dist > 5) continue;
    const half = gateWidth(g.tags) / 2;
    gaps.push([p.along - half, p.along + half, `gate ${g.tags.name ?? 'node/' + g.id}`]);
  }
  for (const f of paths) {
    const c = f.geometry.coordinates.map(xy);
    for (let k = 1; k < c.length; k++) {
      for (let i = 1; i < pts.length; i++) {
        const t = cross(pts[i - 1], pts[i], c[k - 1], c[k]);
        if (t == null) continue;
        // only paths that go through the wall, not ones running alongside it
        const a = sub(pts[i], pts[i - 1]), b = sub(c[k], c[k - 1]);
        const sin = Math.abs(a[0] * b[1] - a[1] * b[0]) / (len(a) * len(b));
        if (sin < 0.5) continue;
        const along = cum[i - 1] + t * (cum[i] - cum[i - 1]);
        const half = (pathWidth[f.properties.kind] ?? 3) / 2 / sin;
        gaps.push([along - half, along + half, `${f.properties.kind} ${f.id}${f.properties.name ? ' ' + f.properties.name : ''}`]);
      }
    }
  }
  // samples: open (gap), blocked by a building, or wall
  const N = Math.max(1, Math.round(L / STEP));
  const kind = Array.from({ length: N + 1 }, (_, i) => {
    const d = (i / N) * L;
    if (gaps.some(([a, b]) => d >= a && d <= b)) return 'gap';
    const p = at(d);
    if (buildings.some((r) => pointInRing(p, r) || r.some((q, j) => j && toSeg(p, r[j - 1], q).dist < 0.6))) return 'building';
    return 'wall';
  });
  let start = -1;
  const pillarAt = (d) => out.push({ type: 'Feature', properties: { part: 'pillar', angle: Math.round(dirAt(d) * 1000) / 1000 }, geometry: { type: 'Point', coordinates: ll(at(d)) } });
  for (let i = 0; i <= N + 1; i++) {
    const isWall = i <= N && kind[i] === 'wall';
    if (isWall && start < 0) start = i;
    if (!isWall && start >= 0) {
      const [d0, d1] = [(start / N) * L, ((i - 1) / N) * L];
      if (d1 - d0 >= 1.5) {
        const inner = pts.filter((_, k) => cum[k] > d0 && cum[k] < d1);
        out.push({ type: 'Feature', properties: { part: 'wall' }, geometry: { type: 'LineString', coordinates: [at(d0), ...inner, at(d1)].map(ll) } });
        // a pillar where the wall ends at a gate or its own end, not against a building
        if (start === 0 || kind[start - 1] === 'gap') pillarAt(d0 + 0.6);
        if (i > N || kind[i] === 'gap') pillarAt(d1 - 0.6);
      }
      start = -1;
    }
  }
  report.push(`${run.name}: ${Math.round(L)} m, ${gaps.length} openings`);
  for (const [a, b, why] of gaps.sort((x, y) => x[0] - y[0])) report.push(`  open ${Math.round(a)}-${Math.round(b)} m: ${why}`);
}

// one pillar where two walls meet
const pillars = out.filter((f) => f.properties.part === 'pillar');
for (let i = pillars.length - 1; i >= 0; i--) {
  const a = xy(pillars[i].geometry.coordinates);
  if (pillars.slice(0, i).some((q) => len(sub(xy(q.geometry.coordinates), a)) < 2.5)) out.splice(out.indexOf(pillars[i]), 1);
}

// every entrance in places.json should be at an opening
const ends = out.filter((f) => f.properties.part === 'pillar').map((f) => xy(f.geometry.coordinates));
for (const p of places.places.filter((p) => p.category === 'entrance')) {
  const d = Math.min(...ends.map((q) => len(sub(q, xy(p.position)))));
  report.push(`${d < 25 ? 'ok  ' : 'FAR '} ${p.name}: nearest gate pillar ${Math.round(d)} m`);
}

await writeFile(OUT, JSON.stringify({
  type: 'FeatureCollection',
  generated: new Date().toISOString().slice(0, 10),
  attribution: '© OpenStreetMap contributors (ODbL)',
  source: `OSM ways ${CLARENCE_WALLS.join(', ')} (barrier=wall) and relation ${UNIVERSITY} (university boundary)`,
  features: out,
}));
console.log(report.join('\n'));
console.log(`${out.filter((f) => f.properties.part === 'wall').length} wall pieces, ${out.filter((f) => f.properties.part === 'pillar').length} pillars → data/walls.geojson`);
