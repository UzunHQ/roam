// Builds data/walls.geojson: the low stone wall along the campus's east edge (Roehampton Lane)
// and south-west edge (Clarence Lane), from OpenStreetMap. The app turns it into stone blocks,
// piers and gates (src/map.ts).
// Run: npm run build:walls   (after build:campus, since it reads the buildings and paths)
// Flags: --cache  reuse scripts/.overpass-walls-cache.json instead of downloading
//
// One continuous wall, from the university's north-east corner on Roehampton Lane, down to the
// corner with Clarence Lane and west along it:
//  - Roehampton Lane: no wall is mapped there, so it follows the university boundary
//    (amenity=university).
//  - Clarence Lane: the barrier=wall ways mapped along it.
// It opens only at entrances: the named ones (places.json entrances and named OSM gates) get a
// big garden gate; other OSM gates (barrier=gate etc.) and doors (entrance=*) on the line get a
// plain opening between two pillars. Where a building stands on the line, the wall runs round
// the building's outer side, against its walls. Piers stiffen it every ~17 m and at corners.
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

const MIN_PIECE = 5; // shorter bits of wall between two openings are dropped (the openings merge)
const PIER_EVERY = 17;
const FACADE_GAP = 0.95; // how far outside a building's wall the campus wall runs

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
  node["entrance"](${bbox});
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
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => mul(v, 1 / (len(v) || 1));
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const r1 = (v) => Math.round(v * 10) / 10;

function toSeg(p, a, b) {
  const d = sub(b, a), L = d[0] * d[0] + d[1] * d[1];
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L)) : 0;
  return { dist: Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]), t };
}
/** where segment ab crosses cd: [t along ab, u along cd], or null */
function cross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  if (!(d1 * d2 < 0 && d3 * d4 < 0)) return null;
  return [d3 / (d3 - d4), d1 / (d1 - d2)];
}
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
const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length]; a += x0 * y1 - x1 * y0; } return a / 2; };

/** a polyline with lengths along it */
function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
  const at = (d) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), t));
  };
  const dirAt = (d) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    return unit(sub(pts[i], pts[i - 1]));
  };
  const project = (p) => {
    let best = { dist: Infinity, along: 0 };
    for (let i = 1; i < pts.length; i++) {
      const r = toSeg(p, pts[i - 1], pts[i]);
      if (r.dist < best.dist) best = { dist: r.dist, along: cum[i - 1] + r.t * (cum[i] - cum[i - 1]) };
    }
    return best;
  };
  /** the line between d0 and d1, with its own vertices */
  const slice = (d0, d1) => [at(d0), ...pts.filter((_, k) => cum[k] > d0 && cum[k] < d1), at(d1)];
  return { pts, cum, L: cum.at(-1), at, dirAt, project, slice };
}

// ---------- 1. one continuous line: NE corner → corner with Clarence Lane → west end ----------
const geom = (el) => el.geometry.map((p) => [p.lon, p.lat]);
const way = (id) => osm.elements.find((el) => el.type === 'way' && el.id === id);
const [clarenceWest, clarenceEast] = CLARENCE_WALLS.map(way);
if (!clarenceWest || !clarenceEast) throw new Error('Clarence Lane wall ways not found in OSM');
const uni = osm.elements.find((el) => el.type === 'relation' && el.id === UNIVERSITY);
const ring = uni?.members.find((m) => m.role === 'outer' && m.geometry?.some((p) => same([p.lon, p.lat], EAST_FROM)));
if (!ring) throw new Error('University boundary along Roehampton Lane not found');
let east;
{
  const pts = ring.geometry.map((p) => [p.lon, p.lat]);
  const i = pts.findIndex((p) => same(p, EAST_FROM)), j = pts.findIndex((p) => same(p, EAST_TO));
  if (i < 0 || j < 0 || j <= i) throw new Error('Unexpected order of the university boundary');
  east = pts.slice(i, j + 1);
}
// Clarence Lane from the corner westwards: the east wall reversed, then the west one (its far end)
const clarence = [...geom(clarenceEast).reverse(), ...geom(clarenceWest)];
if (!same(clarence[0], east.at(-1))) throw new Error('The two walls no longer meet at the corner');
let line = simplify([...east, ...clarence.slice(1)].map(xy), 0.3);

// the campus side (for which way is "outside" and which way the gates open)
const inner = places.places.filter((p) => p.category !== 'entrance').map((p) => xy(p.position));
const centre = mul(inner.reduce(add, [0, 0]), 1 / inner.length);

// ---------- 2. round buildings that stand on the line, on their outer side ----------
const buildings = campus.features
  .filter((f) => f.properties.layer === 'building' && f.geometry.type === 'Polygon')
  .map((f) => ({ name: f.properties.name ?? f.id, ring: f.geometry.coordinates[0].map(xy).slice(0, -1) }));
const rerouted = [];
for (let guard = 0; guard < 40; guard++) {
  let changed = false;
  for (const b of buildings) {
    const R = b.ring, nR = R.length;
    const hits = [];
    for (let i = 1; i < line.length; i++) {
      for (let k = 0; k < nR; k++) {
        const c = cross(line[i - 1], line[i], R[k], R[(k + 1) % nR]);
        if (c) hits.push({ seg: i, t: c[0], edge: k, p: add(line[i - 1], mul(sub(line[i], line[i - 1]), c[0])) });
      }
    }
    if (hits.length < 2) continue;
    hits.sort((a, b) => a.seg - b.seg || a.t - b.t);
    // each pass through the building on its own (a C-shaped building is two arms, not one block)
    const [a, z] = [hits[0], hits[1]];
    const ccw = signedArea(R) > 0;
    const outward = (k) => { const d = unit(sub(R[(k + 1) % nR], R[k])); return ccw ? [d[1], -d[0]] : [-d[1], d[0]]; };
    // vertex normals, pointing out of the building
    const vNormal = (k) => unit(add(outward((k - 1 + nR) % nR), outward(k)));
    const walk = (dir) => {
      const out = [add(a.p, mul(outward(a.edge), FACADE_GAP))];
      let k = dir > 0 ? (a.edge + 1) % nR : a.edge;
      const stop = dir > 0 ? (z.edge + 1) % nR : z.edge;
      for (let g = 0; g < nR && k !== stop; g++) {
        out.push(add(R[k], mul(vNormal(k), FACADE_GAP * 1.2)));
        k = (k + dir + nR) % nR;
      }
      out.push(add(z.p, mul(outward(z.edge), FACADE_GAP)));
      return out;
    };
    const fwd = walk(1), back = walk(-1);
    // the way round on the street side: away from campus, measured across the line it replaces
    const across = unit(sub(z.p, a.p)), side = [-across[1], across[0]];
    const outerSign = -Math.sign((centre[0] - a.p[0]) * side[0] + (centre[1] - a.p[1]) * side[1]) || 1;
    const outerness = (path) => path.reduce((s, p) => s + ((p[0] - a.p[0]) * side[0] + (p[1] - a.p[1]) * side[1]) * outerSign, 0) / path.length;
    const around = outerness(fwd) >= outerness(back) ? fwd : back;
    line = [...line.slice(0, a.seg), ...around, ...line.slice(z.seg)];
    rerouted.push(b.name);
    changed = true;
    break;
  }
  if (!changed) break;
}
line = simplify(line, 0.15);
const M = measure(line);

// ---------- 3. openings ----------
const paths = campus.features.filter((f) => f.properties.layer === 'path' && f.geometry.type === 'LineString');
const pathWidth = { footpath: 3.5, service: 6.5, road: 8 };
const crossings = []; // where mapped paths and roads pass the wall line
for (const f of paths) {
  const c = f.geometry.coordinates.map(xy);
  for (let k = 1; k < c.length; k++) {
    for (let i = 1; i < M.pts.length; i++) {
      const t = cross(M.pts[i - 1], M.pts[i], c[k - 1], c[k]);
      if (!t) continue;
      const a = sub(M.pts[i], M.pts[i - 1]), b2 = sub(c[k], c[k - 1]);
      const sin = Math.abs(a[0] * b2[1] - a[1] * b2[0]) / (len(a) * len(b2));
      if (sin < 0.5) continue;
      crossings.push({ along: M.cum[i - 1] + t[0] * (M.cum[i] - M.cum[i - 1]), width: (pathWidth[f.properties.kind] ?? 3.5) / sin, what: `${f.properties.kind} ${f.id}` });
    }
  }
}
const nodes = osm.elements.filter((el) => el.type === 'node');
const gateNodes = nodes.filter((nd) => nd.tags?.barrier).map((nd) => ({ nd, ...M.project(xy([nd.lon, nd.lat])) })).filter((g) => g.dist <= 4);
const doorNodes = nodes.filter((nd) => nd.tags?.entrance && !nd.tags?.barrier).map((nd) => ({ nd, ...M.project(xy([nd.lon, nd.lat])) })).filter((g) => g.dist <= 2.5);
const gateWidth = (t) => (t.barrier === 'lift_gate' ? 5 : (t.access === 'no' || t.motor_vehicle === 'no') && t.foot === 'yes' ? 2.5 : 4);
const widthNear = (along, fallback) => {
  const c = crossings.filter((x) => Math.abs(x.along - along) < 4).sort((a, b) => b.width - a.width)[0];
  return c ? Math.max(c.width, fallback) : fallback;
};

const cuts = []; // { from, to, named, name, why }
// named entrances: the gate on the line next to them, else the road through the wall, else straight across
const named = [
  ...places.places.filter((p) => p.category === 'entrance').map((p) => ({ name: p.name, place: p.id, p: xy(p.position) })),
  ...nodes.filter((nd) => nd.tags?.barrier && nd.tags.name).map((nd) => ({ name: nd.tags.name, p: xy([nd.lon, nd.lat]) })),
];
const namedDone = [];
for (const e of named) {
  const pr = M.project(e.p);
  if (pr.dist > 30) { console.warn(`! ${e.name} is ${Math.round(pr.dist)} m from the wall, no gate`); continue; }
  const gate = gateNodes.filter((g) => len(sub(xy([g.nd.lon, g.nd.lat]), e.p)) < 25).sort((a, b) => Math.abs(a.along - pr.along) - Math.abs(b.along - pr.along))[0];
  const road = crossings.filter((c) => Math.abs(c.along - pr.along) < 25).sort((a, b) => Math.abs(a.along - pr.along) - Math.abs(b.along - pr.along))[0];
  const along = gate ? gate.along : road ? road.along : pr.along;
  const how = gate ? `OSM gate node/${gate.nd.id}` : road ? `where ${road.what} passes` : 'straight across from the marker';
  // one named gate per opening (Clarence Lane entrance = OSM "Clarence Lane Gate")
  const dup = namedDone.find((d) => Math.abs(d.along - along) < 15);
  if (dup) { dup.names.push(e.name); if (e.place) dup.place ??= e.place; continue; }
  const width = Math.max(4.6, widthNear(along, gate ? gateWidth(gate.nd.tags) : 5));
  namedDone.push({ along, width, names: [e.name], place: e.place, how });
}
for (const d of namedDone) cuts.push({ from: d.along - d.width / 2, to: d.along + d.width / 2, named: true, name: d.names[0], place: d.place, why: `${d.names.join(' = ')} (${d.how})` });
for (const g of gateNodes) {
  if (cuts.some((c) => g.along > c.from - 1 && g.along < c.to + 1)) continue;
  const width = gateWidth(g.nd.tags);
  cuts.push({ from: g.along - width / 2, to: g.along + width / 2, named: false, gate: true, why: `OSM gate node/${g.nd.id}${g.nd.tags.access ? ' access=' + g.nd.tags.access : ''}` });
}
for (const g of doorNodes) {
  if (cuts.some((c) => g.along > c.from - 1 && g.along < c.to + 1)) continue;
  cuts.push({ from: g.along - 1.1, to: g.along + 1.1, named: false, why: `OSM entrance=${g.nd.tags.entrance} node/${g.nd.id}` });
}
cuts.sort((a, b) => a.from - b.from);
// merge overlapping openings, and the ones with less than MIN_PIECE of wall between them
for (let i = 1; i < cuts.length; i++) {
  const a = cuts[i - 1], b = cuts[i];
  if (b.from - a.to < MIN_PIECE) {
    const keep = a.named ? a : b.named ? b : a;
    cuts.splice(i - 1, 2, { ...keep, gate: a.gate || b.gate, from: Math.min(a.from, b.from), to: Math.max(a.to, b.to), why: `${a.why} + ${b.why}` });
    i--;
  }
}

// a plain opening right at either end of the wall would leave its gate hanging: the wall just
// ends there, on a pillar
for (let i = cuts.length - 1; i >= 0; i--) {
  const c = cuts[i];
  if (!c.named && (c.from < MIN_PIECE || c.to > M.L - MIN_PIECE)) { console.log(`  (no opening at the very end of the wall: ${c.why})`); cuts.splice(i, 1); }
}

// ---------- 4. wall pieces, piers, pillars, gates ----------
const out = [];
const point = (part, p, dir, extra = {}) => out.push({ type: 'Feature', properties: { part, angle: Math.round(Math.atan2(dir[1], dir[0]) * 1000) / 1000, ...extra }, geometry: { type: 'Point', coordinates: ll(p) } });
const edges = [0, ...cuts.flatMap((c) => [c.from, c.to]), M.L];
const pieces = [];
for (let i = 0; i < edges.length; i += 2) {
  const [d0, d1] = [Math.max(0, edges[i]), Math.min(M.L, edges[i + 1])];
  if (d1 - d0 < MIN_PIECE) continue; // a stub at either end of the wall
  pieces.push([d0, d1, i === 0 ? null : cuts[i / 2 - 1], i / 2 < cuts.length ? cuts[i / 2] : null]);
}
for (const [d0, d1, before, after] of pieces) {
  out.push({ type: 'Feature', properties: { part: 'wall' }, geometry: { type: 'LineString', coordinates: M.slice(d0, d1).map(ll) } });
  // the wall always ends on something: a pillar (its own end, a plain opening) or a gate pillar
  if (!before?.named) point('pillar', M.at(d0 + 0.5), M.dirAt(d0 + 0.5));
  if (!after?.named) point('pillar', M.at(d1 - 0.5), M.dirAt(d1 - 0.5));
  // piers: at corners, then evenly in between
  const anchors = [d0 + 0.5];
  for (let k = 1; k < M.pts.length - 1; k++) {
    if (M.cum[k] < d0 + 4 || M.cum[k] > d1 - 4) continue;
    const a = unit(sub(M.pts[k], M.pts[k - 1])), b = unit(sub(M.pts[k + 1], M.pts[k]));
    if (a[0] * b[0] + a[1] * b[1] < Math.cos((40 * Math.PI) / 180) && anchors.every((x) => M.cum[k] - x > 4)) {
      anchors.push(M.cum[k]);
      point('pier', M.pts[k], add(a, b));
    }
  }
  anchors.push(d1 - 0.5);
  for (let k = 1; k < anchors.length; k++) {
    const gap = anchors[k] - anchors[k - 1], m = Math.round(gap / PIER_EVERY);
    for (let j = 1; j < m; j++) { const d = anchors[k - 1] + (gap * j) / m; point('pier', M.at(d), M.dirAt(d)); }
  }
}
// plain OSM gates: a closed iron gate across the opening (doorways stay open)
for (const c of cuts.filter((c) => !c.named && c.gate)) {
  out.push({ type: 'Feature', properties: { part: 'railing' }, geometry: { type: 'LineString', coordinates: [ll(M.at(c.from)), ll(M.at(c.to))] } });
}
for (const c of cuts.filter((c) => c.named)) {
  const [a, b] = [M.at(c.from), M.at(c.to)];
  const dir = unit(sub(b, a)), left = [-dir[1], dir[0]];
  const campusSide = Math.sign((centre[0] - (a[0] + b[0]) / 2) * left[0] + (centre[1] - (a[1] + b[1]) / 2) * left[1]) || 1;
  out.push({ type: 'Feature', properties: { part: 'gate', name: c.name, place: c.place ?? null, in: campusSide }, geometry: { type: 'LineString', coordinates: [ll(a), ll(b)] } });
}

// ---------- report ----------
console.log(`Wall: ${Math.round(M.L)} m in one line, ${pieces.length} pieces, ${cuts.length} openings`);
if (rerouted.length) console.log(`Runs round the outside of: ${[...new Set(rerouted)].join(', ')}`);
for (const c of cuts) console.log(`  ${c.named ? 'GATE ' : c.gate ? 'gate ' : 'door '} ${String(Math.round(c.from)).padStart(4)}-${String(Math.round(c.to)).padEnd(4)} m  ${r1(c.to - c.from)} m wide  ${c.why}`);
for (const p of places.places.filter((p) => p.category === 'entrance')) {
  const g = out.find((f) => f.properties.part === 'gate' && f.properties.place === p.id);
  console.log(`${g ? 'ok  ' : 'MISS'} ${p.name}: ${g ? 'garden gate' : 'no gate!'}`);
}
const short = pieces.filter(([d0, d1]) => d1 - d0 < MIN_PIECE);
if (short.length) console.warn(`! ${short.length} pieces shorter than ${MIN_PIECE} m`);

await writeFile(OUT, JSON.stringify({
  type: 'FeatureCollection',
  generated: new Date().toISOString().slice(0, 10),
  attribution: '© OpenStreetMap contributors (ODbL)',
  source: `OSM ways ${CLARENCE_WALLS.join(', ')} (barrier=wall), relation ${UNIVERSITY} (university boundary), gates and entrances`,
  features: out,
}));
const count = (part) => out.filter((f) => f.properties.part === part).length;
console.log(`${count('wall')} wall pieces, ${count('pier')} piers, ${count('pillar')} pillars, ${count('gate')} garden gates, ${count('railing')} plain gates → data/walls.geojson`);
