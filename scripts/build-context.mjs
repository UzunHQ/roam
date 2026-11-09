// Adds the surroundings to data/campus.geojson, after build-campus.mjs (npm run build:campus):
//  - the first row of buildings along Roehampton Lane (both sides, Southlands down to Chadwick Hall)
//    and along Clarence Lane, plus every building inside the map's edge that isn't the university's
//    (Ibstock Place School beside the 5-a-side pitch), drawn plain (campus: false) so they never read
//    as campus buildings
//  - Queen Mary's Hospital's other buildings and its car park
//  - street trees: OpenStreetMap's own (natural=tree), and where it has none, rows along Roehampton
//    Lane's pavements, round Chadwick Hall's plot and north-east of Southlands, kept clear of roads,
//    paths, walls and buildings (generated: true, decoration only, like the campus's own)
//  - the grass running track on the Playing Field (OSM relation/21170980), as white lines
// Everything it adds carries `context: true`, so running it again replaces what it added before.
// Flags: --cache  reuse scripts/.overpass-context-cache.json instead of downloading
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('data/campus.geojson', ROOT);
const CACHE = new URL('scripts/.overpass-context-cache.json', ROOT);
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
const area = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const centre = (r) => { const m = r.slice(0, -1); return [m.reduce((a, p) => a + p[0], 0) / m.length, m.reduce((a, p) => a + p[1], 0) / m.length]; };
const ringDist = (r, segs) => Math.min(...r.map((p) => distToSegs(p, segs)));
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const fc = JSON.parse(await readFile(OUT, 'utf8'));
const before = fc.features.length;
fc.features = fc.features.filter((f) => !f.properties?.context);
const features = fc.features;
const places = JSON.parse(await readFile(new URL('data/places.json', ROOT), 'utf8')).places;
const walls = JSON.parse(await readFile(new URL('data/walls.geojson', ROOT), 'utf8'));
const wallSegs = walls.features.filter((f) => f.properties?.part === 'wall' && f.geometry.type === 'LineString').flatMap((f) => segsOf(f.geometry.coordinates.map(toM)));

const edgeF = features.find((f) => f.properties.layer === 'mapedge');
const EDGE = edgeF.geometry.coordinates[0].map(toM);
// anything already on the map (buildings, the mausoleum and the coop, drawn as monuments)
const have = new Set(features.map((f) => f.properties.osmId ?? f.id).filter(Boolean));
const footprints = new Set(places.map((p) => p.footprintId).filter(Boolean));

const highways = osm.elements.filter((e) => e.type === 'way' && e.tags?.highway && e.geometry).map((e) => ({ tags: e.tags, pts: e.geometry.map((p) => toM(ll(p))) }));
const laneSegs = highways.filter((h) => h.tags.name === 'Roehampton Lane').flatMap((h) => segsOf(h.pts));
const clarenceSegs = highways.filter((h) => h.tags.name === 'Clarence Lane').flatMap((h) => segsOf(h.pts));
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway']);
const otherRoadSegs = highways.filter((h) => h.tags.name !== 'Roehampton Lane' && !FOOT.has(h.tags.highway)).flatMap((h) => segsOf(h.pts));
const footSegs = highways.filter((h) => FOOT.has(h.tags.highway)).flatMap((h) => segsOf(h.pts));
const hospitalSite = osm.elements.find((e) => e.type === 'way' && e.tags?.amenity === 'hospital');
const SITE = hospitalSite ? hospitalSite.geometry.map((p) => toM(ll(p))) : null;

// ---------- buildings ----------
// the outer ring of a way, or of a multipolygon's largest closed outer member
function outerOf(e) {
  if (e.type === 'way') return e.geometry?.length > 3 ? e.geometry.map(ll) : null;
  const outers = (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry?.length > 3).map((m) => m.geometry.map(ll))
    .filter((r) => r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]);
  return outers.sort((a, b) => area(b.map(toM)) - area(a.map(toM)))[0] ?? null;
}
const heightOf = (t) => (t.height ? parseFloat(t.height) || null : t['building:levels'] ? (parseFloat(t['building:levels']) || 2) * 3.2 : null);
const PITCHED = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow']);
const counts = { lane: 0, clarence: 0, map: 0, hospital: 0, place: 0 };
const bRings = features.filter((f) => f.properties.layer === 'building').map((f) => f.geometry.coordinates[0].map(toM));
for (const e of osm.elements) {
  if (!e.tags?.building || e.tags.building === 'no') continue;
  const id = `${e.type}/${e.id}`;
  if (have.has(id)) continue;
  const ring = outerOf(e);
  if (!ring) continue;
  const m = ring.map(toM), c = centre(m), a = area(m);
  let why = null;
  if (footprints.has(id)) why = 'place';
  else if (SITE && pointInRing(c, SITE)) why = 'hospital';
  else if (a < 15) continue; // sheds and bin stores
  // inside the map's edge, west of Roehampton Lane (east of it, only the first row along the lane)
  else if (c[0] < 140 && pointInRing(c, EDGE)) why = 'map';
  // the first row only: a house whose nearest corner is this close to the road's centre line
  else if (c[1] > -420 && c[1] < 660 && ringDist(m, laneSegs) < 30) why = 'lane';
  else if (ringDist(m, clarenceSegs) < 24) why = 'clarence';
  if (!why) continue;
  if (why === 'hospital' && e.tags.building !== 'hospital' && !e.tags.name && e.tags.building !== 'yes') continue; // the houses on the site's edge: only if they're on a road
  counts[why]++;
  have.add(id);
  bRings.push(m);
  const pitched = PITCHED.has(e.tags.building) && !['flat'].includes(e.tags['roof:shape']) && ring.length <= 12;
  features.push({
    type: 'Feature', id,
    properties: { layer: 'building', osmId: id, name: e.tags.name ?? null, building: e.tags.building, height: heightOf(e.tags), campus: false, college: null, context: true, ...(pitched ? { roof: 'tile' } : {}), ...(why === 'hospital' ? { hospital: true } : {}) },
    geometry: { type: 'Polygon', coordinates: [ring.map((p) => [round(p[0]), round(p[1])])] },
  });
}

// ---------- courtyards ----------
// a building that isn't the university's and is an OSM multipolygon (Queen Mary's Hospital's main
// building) gets its inner rings back, so its courtyards show (build-campus.mjs keeps the outer only)
let yards = 0;
for (const f of features) {
  if (f.properties.layer !== 'building' || f.properties.campus !== false || !f.properties.osmId?.startsWith('relation/')) continue;
  const rel = osm.elements.find((e) => `${e.type}/${e.id}` === f.properties.osmId);
  const inners = (rel?.members ?? []).filter((m) => m.role === 'inner' && m.geometry?.length > 3).map((m) => m.geometry.map((p) => [round(p.lon), round(p.lat)]));
  if (!inners.length) continue;
  f.geometry.coordinates = [f.geometry.coordinates[0], ...inners];
  f.properties.courtyards = true;
  yards += inners.length;
}

// ---------- the hospital's car park ----------
let parks = 0;
for (const e of osm.elements) {
  if (e.type !== 'way' || e.tags?.amenity !== 'parking' || !e.geometry || !SITE) continue;
  const m = e.geometry.map((p) => toM(ll(p)));
  if (!pointInRing(centre(m), SITE)) continue;
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
const trees = features.filter((f) => f.properties.layer === 'tree').map((f) => toM(f.geometry.coordinates));
const stops = places.filter((p) => p.kind === 'bus-stop' || p.category === 'entrance').map((p) => toM(p.position));
const nearBuilding = (p, d) => bRings.some((r) => pointInRing(p, r) || r.some((q, k) => k < r.length - 1 && segDist(p, q, r[k + 1]) < d));
const parkingRings = features.filter((f) => f.properties.layer === 'parking' && f.geometry.type === 'Polygon').map((f) => f.geometry.coordinates[0].map(toM));
const clear = (p, laneMin = 7.5) =>
  !nearBuilding(p, 4)
  && distToSegs(p, laneSegs) >= laneMin
  && distToSegs(p, otherRoadSegs) >= 6
  && distToSegs(p, footSegs) >= 2.2
  && distToSegs(p, wallSegs) >= 2.5
  && !stops.some((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) < 8)
  && !parkingRings.some((r) => pointInRing(p, r))
  && !trees.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) < 5.5);
let added = { osm: 0, lane: 0, chadwick: 0, southlands: 0 };
const plant = (p, kind, s = 0.85 + rand() * 0.45) => {
  trees.push(p);
  features.push({ type: 'Feature', properties: { layer: 'tree', context: true, ...(kind === 'osm' ? {} : { generated: true }), s: Math.round(s * 100) / 100 }, geometry: { type: 'Point', coordinates: fromM(p) } });
  added[kind]++;
};
// OpenStreetMap's own trees near the lane
for (const e of osm.elements) {
  if (e.type !== 'node' || e.tags?.natural !== 'tree') continue;
  const p = toM([e.lon, e.lat]);
  if (distToSegs(p, laneSegs) < 60 && !trees.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) < 3)) plant(p, 'osm', 1.1);
}
for (const e of osm.elements) {
  if (e.type !== 'way' || e.tags?.natural !== 'tree_row' || !e.geometry) continue;
  const line = e.geometry.map((p) => toM(ll(p)));
  if (distToSegs(line[0], laneSegs) > 60) continue;
  for (const [a, b] of segsOf(line)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let d = 0; d < L; d += 8) { const p = [a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L]; if (clear(p, 6)) plant(p, 'osm'); }
  }
}
// rows along both pavements of Roehampton Lane, from Chadwick Hall's south end to north of Southlands
{
  const lane = highways.filter((h) => h.tags.name === 'Roehampton Lane').flatMap((h) => segsOf(h.pts));
  for (const [a, b] of lane) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!L) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    for (let d = rand() * 6; d < L; d += 12 + rand() * 4) {
      const q = [a[0] + ux * d, a[1] + uy * d];
      if (q[1] < -350 || q[1] > 660) continue;
      for (const side of [-1, 1]) {
        const off = 9 + rand() * 1.5;
        const p = [q[0] - uy * off * side, q[1] + ux * off * side];
        if (clear(p)) plant(p, 'lane');
      }
    }
  }
}
// round Chadwick Hall's plot, just outside its wall (OSM way/393563937)
{
  // (the plot's outline is in build-campus.mjs's cache, not this one)
  const main = new URL('scripts/.overpass-cache.json', ROOT);
  const plot = existsSync(main) ? JSON.parse(await readFile(main, 'utf8')).elements.find((e) => e.type === 'way' && e.id === 393563937) : null;
  const ringLL = plot?.geometry?.map(ll) ?? null;
  const ring = ringLL ? ringLL.map(toM) : null;
  if (ring) {
    const c = centre(ring);
    for (const [a, b] of segsOf(ring)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 3 + rand() * 4; d < L - 2; d += 9 + rand() * 3) {
        const q = [a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L];
        const v = [q[0] - c[0], q[1] - c[1]], k = Math.hypot(...v);
        const p = [q[0] + (v[0] / k) * (4.5 + rand() * 2), q[1] + (v[1] / k) * (4.5 + rand() * 2)];
        if (!pointInRing(p, ring) && clear(p)) plant(p, 'chadwick');
      }
    }
  }
}
// north-east of Southlands: the verges between Southlands and Roehampton Lane's top end
{
  for (let x = 60; x < 240; x += 9) for (let y = 470; y < 660; y += 9) {
    const p = [x + (rand() - 0.5) * 5, y + (rand() - 0.5) * 5];
    if (distToSegs(p, laneSegs) > 40 || rand() < 0.45) continue;
    if (clear(p)) plant(p, 'southlands');
  }
}

await writeFile(OUT, JSON.stringify(fc));
console.log(`context: ${before} -> ${fc.features.length} features`);
console.log(`  buildings: ${JSON.stringify(counts)}; courtyards: ${yards}; hospital car parks: ${parks}; running track: ${track ? 'yes' : 'no'}`);
console.log(`  trees: ${JSON.stringify(added)}`);
