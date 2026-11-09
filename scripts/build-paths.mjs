// Builds data/paths.json, a small walking graph, from the Overpass download made by
// build-campus.mjs (scripts/.overpass-cache.json). Run: npm run build:paths
//
// Included: OSM highways a pedestrian may use. Excluded: access=no, foot=no, motorways.
// access=private ways count only inside the OSM university outline (campus users are
// authorised there). Steps are flagged so a step-free option can be added once verified.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { CHADWICK_PATHS } from './chadwick.mjs';

const CACHE = new URL('.overpass-cache.json', import.meta.url);
const OUT = new URL('../data/paths.json', import.meta.url);
if (!existsSync(CACHE)) {
  console.error('Run "npm run build:campus" first; it downloads scripts/.overpass-cache.json.');
  process.exit(1);
}
const osm = JSON.parse(await readFile(CACHE, 'utf8'));
// the surroundings' download (scripts/build-context.mjs): the ways of the map's wider island (Roehampton
// Lane south to Whitelands College, Danebury Avenue, Whitelands' own paths), only those with a point
// inside the island's outline (layer "contextzone" in campus.geojson). They share OSM node ids with the
// campus download, so the two join where they meet.
{
  const CONTEXT = new URL('.overpass-context-cache.json', import.meta.url);
  const campus = JSON.parse(await readFile(new URL('../data/campus.geojson', import.meta.url), 'utf8'));
  const zone = campus.features.find((f) => f.properties?.layer === 'contextzone');
  if (existsSync(CONTEXT) && zone) {
    const rings = zone.geometry.coordinates.map((p) => p[0]);
    const inZone = (q) => rings.some((r) => pointInRing(q, r));
    const have = new Set(osm.elements.map((e) => `${e.type}/${e.id}`));
    const ctx = JSON.parse(await readFile(CONTEXT, 'utf8'));
    let n = 0;
    for (const e of ctx.elements) {
      if (e.type !== 'way' || !e.tags?.highway || !e.nodes || !e.geometry || have.has(`way/${e.id}`)) continue;
      if (!e.geometry.some((g) => inZone([g.lon, g.lat]))) continue;
      osm.elements.push(e); n++;
    }
    // (relations too: Whitelands' outline, so its private paths count as campus)
    for (const e of ctx.elements) if (e.type === 'relation' && e.tags?.amenity === 'university' && !have.has(`relation/${e.id}`)) osm.elements.push(e);
    for (const e of ctx.elements) if (e.type === 'way' && e.id === 269315444) osm.elements.push({ ...e, tags: { amenity: 'university' } });
    console.log(`surroundings: ${n} more ways from the island`);
  }
}

const round = (v) => Math.round(v * 1e6) / 1e6;
function metres([lng1, lat1], [lng2, lat2]) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const campus = [];
for (const el of osm.elements) {
  if (el.tags?.amenity !== 'university' || el.tags.building) continue;
  if (el.type === 'way' && el.geometry) campus.push(el.geometry.map((p) => [p.lon, p.lat]));
  if (el.type === 'relation') for (const m of el.members ?? []) if (m.role === 'outer' && m.geometry) campus.push(m.geometry.map((p) => [p.lon, p.lat]));
}
const onCampus = (p) => campus.some((r) => pointInRing(p, r));

const BANNED = new Set(['motorway', 'motorway_link', 'construction', 'proposed', 'raceway', 'bus_guideway']);
const index = new Map(); // osm node id -> our index
const nodes = [];
const edges = [];
let skipped = 0;
const nodeIdx = (id, lng, lat) => {
  if (!index.has(id)) { index.set(id, nodes.length); nodes.push([round(lng), round(lat)]); }
  return index.get(id);
};

for (const w of osm.elements) {
  const t = w.tags;
  if (w.type !== 'way' || !t?.highway || !w.nodes || !w.geometry) continue;
  if (BANNED.has(t.highway) || t.foot === 'no' || (t.access === 'no' && !['yes', 'designated', 'permissive'].includes(t.foot))) { skipped++; continue; }
  const priv = t.access === 'private' && !['yes', 'designated', 'permissive'].includes(t.foot);
  if (priv) {
    const mid = w.geometry[Math.floor(w.geometry.length / 2)];
    if (!onCampus([mid.lon, mid.lat])) { skipped++; continue; }
  }
  const flags = (t.highway === 'steps' ? 1 : 0) | (priv ? 2 : 0);
  for (let i = 0; i < w.nodes.length - 1; i++) {
    const g1 = w.geometry[i], g2 = w.geometry[i + 1];
    if (!g1 || !g2) continue;
    const a = nodeIdx(w.nodes[i], g1.lon, g1.lat), b = nodeIdx(w.nodes[i + 1], g2.lon, g2.lat);
    edges.push([a, b, Math.round(metres(nodes[a], nodes[b]) * 10) / 10, flags]);
  }
}

// Chadwick Hall's grounds (scripts/chadwick.mjs, not in OSM): their paths share nodes where they
// meet, and each one marked `lane` joins the nearest OSM node on Roehampton Lane where it starts
{
  const osmCount = nodes.length;
  const key = ([lng, lat]) => `${round(lng)},${round(lat)}`;
  const drawn = new Map();
  const at = (p) => {
    const k = key(p);
    if (!drawn.has(k)) { drawn.set(k, nodes.length); nodes.push([round(p[0]), round(p[1])]); }
    return drawn.get(k);
  };
  for (const w of CHADWICK_PATHS) {
    const ids = w.ll.map(at);
    for (let i = 0; i < ids.length - 1; i++) edges.push([ids[i], ids[i + 1], Math.round(metres(nodes[ids[i]], nodes[ids[i + 1]]) * 10) / 10, 0]);
    if (w.lane) {
      const lane = osm.elements.find((x) => x.type === 'way' && x.id === 763392451);
      let best = -1, bestD = Infinity;
      for (const id of lane?.nodes ?? []) {
        const k = index.get(id);
        if (k == null || k >= osmCount) continue;
        const d = metres(nodes[k], nodes[ids[0]]);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best < 0 || bestD > 40) throw new Error(`${w.id}: no Roehampton Lane node within 40 m`);
      edges.push([best, ids[0], Math.round(bestD * 10) / 10, 0]);
    }
  }
  console.log(`Chadwick Hall: ${CHADWICK_PATHS.length} drawn paths, ${drawn.size} points`);
}

// keep only the largest connected network, so a route can always be completed
const adj = nodes.map(() => []);
for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
const comp = new Array(nodes.length).fill(-1);
let best = -1, bestSize = 0;
for (let s = 0, c = 0; s < nodes.length; s++) {
  if (comp[s] !== -1) continue;
  let size = 0;
  const stack = [s];
  comp[s] = c;
  while (stack.length) { const x = stack.pop(); size++; for (const y of adj[x]) if (comp[y] === -1) { comp[y] = c; stack.push(y); } }
  if (size > bestSize) { bestSize = size; best = c; }
  c++;
}
const remap = new Map();
const outNodes = [];
nodes.forEach((n, i) => { if (comp[i] === best) { remap.set(i, outNodes.length); outNodes.push(n); } });
const outEdges = edges.filter(([a]) => comp[a] === best).map(([a, b, d, f]) => [remap.get(a), remap.get(b), d, f]);

await writeFile(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  attribution: '© OpenStreetMap contributors (ODbL)',
  note: 'edges: [from, to, metres, flags]; flags 1 = steps, 2 = private campus way',
  nodes: outNodes,
  edges: outEdges,
}));
console.log(`paths.json: ${outNodes.length} nodes, ${outEdges.length} edges (dropped ${nodes.length - outNodes.length} nodes in small disconnected pieces, skipped ${skipped} restricted ways)`);
