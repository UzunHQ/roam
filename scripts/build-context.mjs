// Fits the map's surroundings to one rule, after build-campus.mjs (npm run build:campus):
//
//   The "context zone" is the campus itself (inside the map's edge, west of Roehampton Lane and
//   north of Clarence Lane), Chadwick Hall's plot, Queen Mary's Hospital's site, and a corridor of
//   CONTEXT_BUFFER_M metres either side of the two main roads: Roehampton Lane from Chadwick Hall's
//   south end to Southlands' north wall, and Clarence Lane south of Froebel.
//
//   Inside the zone: OpenStreetMap's buildings in a plain context style (campus: false), only the
//   first row along each road (a building facing the road: its nearest corner within FRONT_M of the
//   centre line and its middle within the corridor); street trees in rows along Roehampton Lane and
//   on open ground (generated, like the campus's own); the hospital's buildings and car park.
//   Outside the zone: nothing. Trees, paths and buildings there are removed from campus.geojson, and
//   the zone's outline (layer "contextzone") becomes the hole in the app's flat background frame,
//   which fades out at its edge (src/map.ts).
//
// Everything it adds carries `context: true`, so running it again replaces it.
// Flags: --cache  reuse scripts/.overpass-context-cache.json instead of downloading
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ---------- the rule's settings ----------
const CONTEXT_BUFFER_M = 50; // corridor half-width, each side of a road's centre line
const FRONT_M = 25; // "first row": the building's nearest corner is this close to the centre line
const LANE_Y = [-350, 560]; // Roehampton Lane, metres north of ORIGIN: Chadwick Hall's south end to Southlands' north wall
const CLARENCE_X = [-243, 175]; // Clarence Lane, metres east of ORIGIN: south of Froebel (the Alton estate, further west, stays out)
const PLOT_PAD_M = 10; // round Chadwick Hall's plot (its trees stand just outside the wall)
const GRID_M = 4; // the zone's outline is traced on a grid this fine, then smoothed
const TREE_GAP_M = 11; // open ground in the zone gets a tree about this far apart (some gaps left)

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('data/campus.geojson', ROOT);
const CACHE = new URL('scripts/.overpass-context-cache.json', ROOT);
const MAIN_CACHE = new URL('scripts/.overpass-cache.json', ROOT);
const BOX = '51.4510,-0.2525,51.4615,-0.2380';
const query = `[out:json][timeout:110];
(
  nwr["building"](${BOX});
  nwr["amenity"~"^(hospital|parking)$"](${BOX});
  node["natural"="tree"](${BOX});
  way["natural"="tree_row"](${BOX});
  way["highway"](${BOX});
  node["entrance"](${BOX});
  relation["leisure"="track"](${BOX});
);
out body geom;`;

let osm;
if (process.argv.includes('--cache') && existsSync(CACHE)) osm = JSON.parse(await readFile(CACHE, 'utf8'));
else {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Roam-campus-map-build/1.0 (unofficial student project)' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass: HTTP ${res.status}`);
  osm = await res.json();
  await writeFile(CACHE, JSON.stringify(osm));
}

// local metres east/north of ORIGIN (the same frame as build-campus.mjs)
const ORIGIN = [-0.246, 51.4555];
const KX = 111320 * Math.cos((ORIGIN[1] * Math.PI) / 180), KY = 111320;
const round = (v) => Math.round(v * 1e6) / 1e6;
const toM = ([lng, lat]) => [(lng - ORIGIN[0]) * KX, (lat - ORIGIN[1]) * KY];
const fromM = ([x, y]) => [round(ORIGIN[0] + x / KX), round(ORIGIN[1] + y / KY)];
const ll = (p) => [p.lon, p.lat];
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const segsOf = (line) => line.slice(1).map((b, i) => [line[i], b]);
const distToSegs = (p, segs) => segs.reduce((d, [a, b]) => Math.min(d, segDist(p, a, b)), Infinity);
const pointInRing = (p, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
};
const signedArea = (r) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const area = (r) => Math.abs(signedArea(r));
const centre = (r) => { const m = r.slice(0, -1); return [m.reduce((a, p) => a + p[0], 0) / m.length, m.reduce((a, p) => a + p[1], 0) / m.length]; };
const ringDist = (r, segs) => Math.min(...r.map((p) => distToSegs(p, segs)));
// a polyline's segments, cut to where one coordinate (0: x, 1: y) lies in [lo, hi]
const clipSegs = (segs, k, [lo, hi]) => segs.flatMap(([a, b]) => {
  const t = (v) => (v - a[k]) / (b[k] - a[k] || 1e-9);
  let t0 = 0, t1 = 1;
  if (a[k] === b[k]) { if (a[k] < lo || a[k] > hi) return []; } else {
    const [u, v] = [t(lo), t(hi)].sort((x, y) => x - y);
    t0 = Math.max(0, u); t1 = Math.min(1, v);
    if (t0 >= t1) return [];
  }
  const at = (s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  return [[at(t0), at(t1)]];
});
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const fc = JSON.parse(await readFile(OUT, 'utf8'));
const sizeBefore = JSON.stringify(fc).length;
fc.features = fc.features.filter((f) => !f.properties?.context);
let features = fc.features;
const places = JSON.parse(await readFile(new URL('data/places.json', ROOT), 'utf8')).places;
const walls = JSON.parse(await readFile(new URL('data/walls.geojson', ROOT), 'utf8'));
const wallSegs = walls.features.filter((f) => f.properties?.part === 'wall' && f.geometry.type === 'LineString').flatMap((f) => segsOf(f.geometry.coordinates.map(toM)));

// ---------- the zone ----------
const EDGE = features.find((f) => f.properties.layer === 'mapedge').geometry.coordinates[0].map(toM);
const highways = osm.elements.filter((e) => e.type === 'way' && e.tags?.highway && e.geometry).map((e) => ({ id: e.id, tags: e.tags, pts: e.geometry.map((p) => toM(ll(p))) }));
const laneAll = highways.filter((h) => h.tags.name === 'Roehampton Lane').flatMap((h) => segsOf(h.pts));
const laneSegs = clipSegs(laneAll, 1, LANE_Y);
// Clarence Lane's through road (not its spurs into the estates south of it)
const clarenceLine = highways.filter((h) => h.tags.name === 'Clarence Lane' && h.tags.highway === 'tertiary').flatMap((h) => segsOf(h.pts));
const clarenceSegs = clipSegs(clarenceLine, 0, CLARENCE_X);
const hospitalSite = osm.elements.find((e) => e.type === 'way' && e.tags?.amenity === 'hospital');
const SITE = hospitalSite ? hospitalSite.geometry.map((p) => toM(ll(p))) : [];
const mainOsm = existsSync(MAIN_CACHE) ? JSON.parse(await readFile(MAIN_CACHE, 'utf8')) : { elements: [] };
const plotEl = mainOsm.elements.find((e) => e.type === 'way' && e.id === 393563937);
const PLOT = plotEl ? plotEl.geometry.map((p) => toM(ll(p))) : [];
const plotSegs = segsOf(PLOT);

// west of Roehampton Lane: on the right of the road, which OSM draws north to south
const westOfLane = (p) => {
  let best = null;
  for (const [a, b] of laneAll) { const d = segDist(p, a, b); if (!best || d < best.d) best = { d, a, b }; }
  const [a, b] = [best.a, best.b];
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0;
};
// south of Clarence Lane's through road, where it runs (its y at this x)
const clarencePts = clarenceLine.flat().sort((a, b) => a[0] - b[0]);
const southOfClarence = (p) => {
  if (p[0] < clarencePts[0][0] || p[0] > clarencePts.at(-1)[0]) return false;
  const k = clarencePts.findIndex((q) => q[0] >= p[0]);
  const a = clarencePts[Math.max(0, k - 1)], b = clarencePts[k];
  const y = a[0] === b[0] ? a[1] : a[1] + ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]);
  return p[1] < y;
};
const inCampus = (p) => pointInRing(p, EDGE) && westOfLane(p) && !southOfClarence(p);
const inPlot = (p) => PLOT.length > 0 && (pointInRing(p, PLOT) || distToSegs(p, plotSegs) <= PLOT_PAD_M);
const inSite = (p) => SITE.length > 0 && pointInRing(p, SITE);
const inCorridor = (p) => distToSegs(p, laneSegs) <= CONTEXT_BUFFER_M || distToSegs(p, clarenceSegs) <= CONTEXT_BUFFER_M;
// places on buildings outside all that (Eastwood Nursery School): their building and a little round it
const outerOf = (e) => {
  if (e.type === 'way') return e.geometry?.length > 3 ? e.geometry.map(ll) : null;
  const outers = (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry?.length > 3).map((m) => m.geometry.map(ll))
    .filter((r) => r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]);
  return outers.sort((a, b) => area(b.map(toM)) - area(a.map(toM)))[0] ?? null;
};
const footprints = new Set(places.map((p) => p.footprintId).filter(Boolean));
const placeRings = osm.elements.filter((e) => footprints.has(`${e.type}/${e.id}`) && e.tags?.building).map(outerOf).filter(Boolean).map((r) => r.map(toM));
const nearPlace = (p) => placeRings.some((r) => pointInRing(p, r) || distToSegs(p, segsOf(r)) <= 6);
const inZone = (p) => inCampus(p) || inPlot(p) || inSite(p) || inCorridor(p) || nearPlace(p);

// ---------- what was there, outside the zone, goes ----------
const removed = { building: 0, tree: 0, path: 0, other: 0 };
const firstPoint = (g) => (g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.type === 'Polygon' ? g.coordinates[0][0] : g.coordinates[0][0][0]);
const KEEP = new Set(['mapedge', 'green', 'golf', 'water', 'waterway', 'golfflag']); // ground: under the frame anyway, cut in build-campus
features = features.filter((f) => {
  const { layer } = f.properties;
  if (KEEP.has(layer)) return true;
  if (layer === 'building' || layer === 'half') {
    if (f.properties.campus !== false || footprints.has(f.properties.osmId)) return true;
    const ok = inZone(centre(f.geometry.coordinates[0].map(toM)));
    if (!ok) removed.building++;
    return ok;
  }
  if (layer === 'path') {
    const ok = f.geometry.coordinates.some((c) => inZone(toM(c)));
    if (!ok) removed.path++;
    return ok;
  }
  const ok = inZone(toM(firstPoint(f.geometry)));
  if (!ok) removed[layer === 'tree' ? 'tree' : 'other']++;
  return ok;
});
// green areas east of Roehampton Lane (cut straight at the old map edge, which showed as a seam): the
// ground there is the plain context ground now
features = features.filter((f) => {
  if (f.properties.layer !== 'green' || f.geometry.type !== 'Polygon') return true;
  const c = centre(f.geometry.coordinates[0].map(toM));
  const ok = inCampus(c) || inPlot(c);
  if (!ok) removed.other++;
  return ok;
});
fc.features = features;

// ---------- Queen Mary's Hospital: one clean block ----------
// OSM draws the main building as a multipolygon with four light wells; Roam draws its outline only
// (no courtyards), with the hospital's own look (src/map.ts: light walls, red roof edge)
for (const f of features) {
  if (f.properties.osmId !== 'relation/1481954') continue;
  f.geometry.coordinates = [f.geometry.coordinates[0]];
  f.properties.hospital = true;
  delete f.properties.courtyards;
}

// ---------- buildings in the zone ----------
const have = new Set(features.map((f) => f.properties.osmId ?? f.id).filter(Boolean));
const heightOf = (t) => (t.height ? parseFloat(t.height) || null : t['building:levels'] ? (parseFloat(t['building:levels']) || 2) * 3.2 : null);
const PITCHED = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow']);
const counts = { lane: 0, clarence: 0, campus: 0, hospital: 0, place: 0 };
const bRings = features.filter((f) => f.properties.layer === 'building').map((f) => f.geometry.coordinates[0].map(toM));
const firstRow = (m, c, segs) => segs.length > 0 && distToSegs(c, segs) <= CONTEXT_BUFFER_M && ringDist(m, segs) <= FRONT_M;
for (const e of osm.elements) {
  if (!e.tags?.building || e.tags.building === 'no') continue;
  const id = `${e.type}/${e.id}`;
  if (have.has(id)) continue;
  const ring = outerOf(e);
  if (!ring) continue;
  const m = ring.map(toM), c = centre(m), a = area(m);
  let why = null;
  if (footprints.has(id)) why = 'place';
  else if (inSite(c)) {
    // the hospital's own buildings (not the houses along the site's edge)
    if (!PITCHED.has(e.tags.building) && e.tags.building !== 'apartments') why = 'hospital';
  } else if (a < 15) continue; // sheds and bin stores
  else if (inCampus(c) && m.every(inZone)) why = 'campus'; // inside the campus but not the university's (Ibstock Place School)
  else if (c[1] >= LANE_Y[0] && c[1] <= LANE_Y[1] && firstRow(m, c, laneSegs)) why = 'lane';
  else if (firstRow(m, c, clarenceSegs)) why = 'clarence';
  if (!why) continue;
  counts[why]++;
  have.add(id);
  bRings.push(m);
  const pitched = PITCHED.has(e.tags.building) && e.tags['roof:shape'] !== 'flat' && ring.length <= 12;
  features.push({
    type: 'Feature', id,
    properties: { layer: 'building', osmId: id, name: e.tags.name ?? null, building: e.tags.building, height: heightOf(e.tags), campus: false, college: null, context: true, ...(pitched ? { roof: 'tile' } : {}), ...(why === 'hospital' ? { hospital: true } : {}) },
    geometry: { type: 'Polygon', coordinates: [ring.map((p) => [round(p[0]), round(p[1])])] },
  });
}

// ---------- the hospital's car park ----------
let parks = 0;
for (const e of osm.elements) {
  if (e.type !== 'way' || e.tags?.amenity !== 'parking' || !e.geometry || !SITE.length) continue;
  const m = e.geometry.map((p) => toM(ll(p)));
  if (!inSite(centre(m))) continue;
  features.push({ type: 'Feature', id: `way/${e.id}`, properties: { layer: 'parking', context: true, osmId: `way/${e.id}` }, geometry: { type: 'Polygon', coordinates: [e.geometry.map((p) => [round(p.lon), round(p.lat)])] } });
  parks++;
}

// ---------- the running track on the Playing Field ----------
const track = osm.elements.find((e) => e.type === 'relation' && e.tags?.leisure === 'track');
if (track) {
  for (const mb of track.members.filter((x) => x.geometry?.length)) {
    features.push({ type: 'Feature', properties: { layer: 'courtline', context: true, track: true }, geometry: { type: 'LineString', coordinates: mb.geometry.map((p) => [round(p.lon), round(p.lat)]) } });
  }
}

// ---------- trees ----------
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway']);
const otherRoadSegs = highways.filter((h) => h.tags.name !== 'Roehampton Lane' && !FOOT.has(h.tags.highway)).flatMap((h) => segsOf(h.pts));
const footSegs = highways.filter((h) => FOOT.has(h.tags.highway)).flatMap((h) => segsOf(h.pts));
const trees = features.filter((f) => f.properties.layer === 'tree').map((f) => toM(f.geometry.coordinates));
const stops = places.filter((p) => p.kind === 'bus-stop' || p.category === 'entrance').map((p) => toM(p.position));
const nearBuilding = (p, d) => bRings.some((r) => pointInRing(p, r) || r.some((q, k) => k < r.length - 1 && segDist(p, q, r[k + 1]) < d));
const parkingRings = features.filter((f) => f.properties.layer === 'parking' && f.geometry.type === 'Polygon').map((f) => f.geometry.coordinates[0].map(toM));
// well inside the zone (a canopy never pokes out of its edge)
const deepInZone = (p) => [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]].every(([dx, dy]) => inZone([p[0] + dx, p[1] + dy]));
const clear = (p) =>
  deepInZone(p)
  && !nearBuilding(p, 4)
  && distToSegs(p, laneAll) >= 7.5
  && distToSegs(p, otherRoadSegs) >= 6
  && distToSegs(p, footSegs) >= 2.2
  && distToSegs(p, wallSegs) >= 2.5
  && !stops.some((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) < 8)
  && !parkingRings.some((r) => pointInRing(p, r))
  && !trees.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) < 5.5);
const added = { osm: 0, lane: 0, chadwick: 0, open: 0 };
const plant = (p, kind, s = 0.85 + rand() * 0.45) => {
  trees.push(p);
  features.push({ type: 'Feature', properties: { layer: 'tree', context: true, ...(kind === 'osm' ? {} : { generated: true }), s: Math.round(s * 100) / 100 }, geometry: { type: 'Point', coordinates: fromM(p) } });
  added[kind]++;
};
// OpenStreetMap's own trees in the zone (outside the campus, which build-campus has already)
for (const e of osm.elements) {
  if (e.type !== 'node' || e.tags?.natural !== 'tree') continue;
  const p = toM([e.lon, e.lat]);
  if (inZone(p) && !inCampus(p) && !trees.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) < 3)) plant(p, 'osm', 1.1);
}
// rows along both pavements of Roehampton Lane
for (const [a, b] of laneSegs) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!L) continue;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  for (let d = rand() * 6; d < L; d += 12 + rand() * 4) {
    const q = [a[0] + ux * d, a[1] + uy * d];
    for (const side of [-1, 1]) {
      const off = 9 + rand() * 1.5;
      const p = [q[0] - uy * off * side, q[1] + ux * off * side];
      if (clear(p)) plant(p, 'lane');
    }
  }
}
// round Chadwick Hall's plot, just outside its wall
if (PLOT.length) {
  const c = centre(PLOT);
  for (const [a, b] of plotSegs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 3 + rand() * 4; d < L - 2; d += 9 + rand() * 3) {
      const q = [a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L];
      const v = [q[0] - c[0], q[1] - c[1]], k = Math.hypot(...v);
      const p = [q[0] + (v[0] / k) * (4.5 + rand() * 2), q[1] + (v[1] / k) * (4.5 + rand() * 2)];
      if (!pointInRing(p, PLOT) && clear(p)) plant(p, 'chadwick');
    }
  }
}
// open ground in the corridor and on the hospital's site: scattered trees, with gaps
for (let x = -420; x < 440; x += TREE_GAP_M) for (let y = -460; y < 600; y += TREE_GAP_M) {
  const p = [x + (rand() - 0.5) * 6, y + (rand() - 0.5) * 6];
  if (rand() < 0.4 || inCampus(p) || pointInRing(p, PLOT)) continue;
  if (clear(p)) plant(p, 'open');
}

// ---------- the zone's outline ----------
// traced round the grid cells inside the zone (inside on the left, so outer rings run anticlockwise
// and holes clockwise), then simplified and smoothed into soft curves
const zoneRings = (() => {
  const X0 = -470, Y0 = -500, X1 = 480, Y1 = 640, G = GRID_M;
  const nx = Math.ceil((X1 - X0) / G), ny = Math.ceil((Y1 - Y0) / G);
  const cell = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cell[i + j * nx] = inZone([X0 + (i + 0.5) * G, Y0 + (j + 0.5) * G]) ? 1 : 0;
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? cell[i + j * nx] : 0);
  const out = new Map(); // "i,j" -> list of [i, j] the boundary edges leaving that corner go to
  const edge = (a, b) => { const k = a.join(); if (!out.has(k)) out.set(k, []); out.get(k).push(b); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) edge([i, j], [i + 1, j]);
    if (!at(i + 1, j)) edge([i + 1, j], [i + 1, j + 1]);
    if (!at(i, j + 1)) edge([i + 1, j + 1], [i, j + 1]);
    if (!at(i - 1, j)) edge([i, j + 1], [i, j]);
  }
  const rings = [];
  for (const [k0, list0] of out) {
    while (list0.length) {
      const start = k0.split(',').map(Number);
      let prev = start, cur = list0.pop();
      const ring = [start];
      for (let guard = 0; guard < 1e6; guard++) {
        ring.push(cur);
        if (cur[0] === start[0] && cur[1] === start[1]) break;
        const nexts = out.get(cur.join());
        // where two cells touch at a corner: turn left first (keeps the two apart)
        const d = [cur[0] - prev[0], cur[1] - prev[1]];
        const turn = (n) => { const e = [n[0] - cur[0], n[1] - cur[1]]; return d[0] * e[1] - d[1] * e[0]; };
        nexts.sort((p, q) => turn(q) - turn(p));
        const next = nexts.shift();
        prev = cur; cur = next;
      }
      rings.push(ring.map(([i, j]) => [X0 + i * G, Y0 + j * G]));
    }
  }
  const simplify = (line, tol) => {
    const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
    const stack = [[0, line.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let worst = -1, wd = 0;
      for (let i = a + 1; i < b; i++) { const d = segDist(line[i], line[a], line[b]); if (d > wd) { wd = d; worst = i; } }
      if (worst > 0 && wd > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
    }
    return line.filter((_, i) => keep[i]);
  };
  const chaikin = (r) => {
    const o = [];
    for (let i = 0; i < r.length - 1; i++) { const [a, b] = [r[i], r[i + 1]]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    o.push(o[0]);
    return o;
  };
  return rings.filter((r) => area(r) > 4 * G * G).map((r) => {
    let s = simplify(r, G * 0.6);
    for (let k = 0; k < 3; k++) s = chaikin(s);
    return simplify(s, 0.4);
  });
})();
const outers = zoneRings.filter((r) => signedArea(r) > 0);
const holes = zoneRings.filter((r) => signedArea(r) < 0);
const polys = outers.map((o) => [o, ...holes.filter((h) => pointInRing(h[0], o))]);
features.push({ type: 'Feature', properties: { layer: 'contextzone', context: true }, geometry: { type: 'MultiPolygon', coordinates: polys.map((p) => p.map((r) => r.map(fromM))) } });

await writeFile(OUT, JSON.stringify(fc));
console.log(`context zone (buffer ${CONTEXT_BUFFER_M} m, first row within ${FRONT_M} m): ${outers.length} part(s), ${holes.length} hole(s)`);
console.log(`  removed outside it: ${JSON.stringify(removed)}`);
console.log(`  buildings added: ${JSON.stringify(counts)}; hospital car parks: ${parks}; running track: ${track ? 'yes' : 'no'}`);
console.log(`  trees added: ${JSON.stringify(added)}`);
console.log(`  campus.geojson ${Math.round(sizeBefore / 1024)} KB -> ${Math.round(JSON.stringify(fc).length / 1024)} KB (before slim-geojson)`);
