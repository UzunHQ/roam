// Builds data/paths.json, a small walking graph, from the Overpass download made by
// build-campus.mjs (scripts/.overpass-cache.json). Run: npm run build:paths
//
// Included: OSM highways a pedestrian may use. Excluded: access=no, foot=no, motorways.
// access=private ways count only inside the OSM university outline (campus users are
// authorised there). Steps are flagged so a step-free option can be added once verified.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const CACHE = new URL('.overpass-cache.json', import.meta.url);
const OUT = new URL('../data/paths.json', import.meta.url);
if (!existsSync(CACHE)) {
  console.error('Run "npm run build:campus" first; it downloads scripts/.overpass-cache.json.');
  process.exit(1);
}
const osm = JSON.parse(await readFile(CACHE, 'utf8'));

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
