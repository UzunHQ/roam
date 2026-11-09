// Compares today's OpenStreetMap walking ways (footway, path, steps, pedestrian, service, and the
// gates and entrances) with the download the map was built from (scripts/.overpass-cache.json and
// .overpass-context-cache.json, which made data/paths.json), and lists every difference over 3 m:
// moved nodes, ways added or removed, changed tags a route depends on, and gates. Writes
// docs/osm-path-diff.md. One Overpass request; the map itself isn't changed (npm run build:campus
// and build:paths do that, once a change is checked).
// usage: node scripts/osm-path-diff.mjs [--cache]   (--cache: reuse scripts/.overpass-paths-now.json)
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { campusWorld, metres, nearSeg, inRing, dist } from './lib/campus-world.mjs';

const ROOT = new URL('../', import.meta.url);
const NOW = new URL('scripts/.overpass-paths-now.json', ROOT);
const world = await campusWorld();
const [w, s, e, n] = world.doc.bounds;
const bbox = `${s},${w},${n},${e}`;
const KINDS = 'footway|path|steps|pedestrian|service|living_street|track|cycleway';
const query = `[out:json][timeout:90];
(
  way["highway"~"^(${KINDS})$"](${bbox});
  node["barrier"~"^(gate|entrance|lift_gate|kissing_gate|turnstile)$"](${bbox});
  node["entrance"](${bbox});
);
out body geom;`;

let now;
if (process.argv.includes('--cache') && existsSync(NOW)) now = JSON.parse(await readFile(NOW, 'utf8'));
else {
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'roam-campus-map path check (github.com/UzunHQ/roam)' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      now = await res.json();
      break;
    } catch (err) { console.warn(`${url}: ${err.message}`); }
  }
  if (!now) throw new Error('Overpass: no server answered');
  await writeFile(NOW, JSON.stringify(now));
}
const was = { elements: [] };
for (const f of ['.overpass-cache.json', '.overpass-context-cache.json']) {
  const u = new URL(`scripts/${f}`, ROOT);
  if (existsSync(u)) was.elements.push(...JSON.parse(await readFile(u, 'utf8')).elements);
}
if (!was.elements.length) { console.error('No earlier download (scripts/.overpass-cache.json): run npm run build:campus first.'); process.exit(1); }

const zone = world.campus.features.find((f) => f.properties?.layer === 'contextzone');
const zoneRings = zone.geometry.coordinates.map((p) => p[0]);
const inZone = (ll) => zoneRings.some((r) => inRing(ll, r));
const kindRe = new RegExp(`^(${KINDS})$`);
const waysOf = (d) => new Map(d.elements.filter((x) => x.type === 'way' && kindRe.test(x.tags?.highway ?? '') && x.geometry).map((x) => [x.id, x]));
const W0 = waysOf(was), W1 = waysOf(now);
const ll = (g) => [g.lon, g.lat];
const touches = (way) => way.geometry.some((g) => inZone(ll(g)));
const ROUTE_TAGS = ['highway', 'access', 'foot', 'tunnel', 'covered', 'layer', 'service'];
const link = (t, id) => `[${t}/${id}](https://www.openstreetmap.org/${t}/${id})`;
const where = (g) => `${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}`;

const moved = [], added = [], removed = [], retagged = [];
for (const [id, a] of W0) {
  if (!touches(a)) continue;
  const b = W1.get(id);
  if (!b) { removed.push(`- ${link('way', id)} (${a.tags.highway}${a.tags.name ? `, ${a.tags.name}` : ''}) is gone from OSM, at ${where(a.geometry[0])}`); continue; }
  const pos = new Map(b.nodes.map((nid, i) => [nid, b.geometry[i]]));
  let worst = 0, at = null;
  a.nodes.forEach((nid, i) => { const q = pos.get(nid); if (q) { const d = dist(ll(a.geometry[i]), ll(q)); if (d > worst) { worst = d; at = q; } } });
  const gone = a.nodes.filter((x) => !pos.has(x)).length, plus = b.nodes.filter((x) => !a.nodes.includes(x)).length;
  // a new or dropped node only matters if the line itself moved: the old line vs the new one
  let shape = 0, shapeAt = null;
  if (gone || plus) {
    const M = metres(ll(a.geometry[0]));
    const segs = b.geometry.slice(1).map((g, i) => [M.xy(ll(b.geometry[i])), M.xy(ll(g))]);
    for (const g of a.geometry) { const p = M.xy(ll(g)); const d = Math.min(...segs.map(([x, y]) => nearSeg(p, x, y).d)); if (d > shape) { shape = d; shapeAt = g; } }
  }
  if (worst > 3 || shape > 3) moved.push(`- ${link('way', id)} (${a.tags.highway}${a.tags.name ? `, ${a.tags.name}` : ''}): ${worst > 3 ? `a node moved ${worst.toFixed(1)} m (now at ${where(at)})` : ''}${worst > 3 && shape > 3 ? '; ' : ''}${shape > 3 ? `redrawn, up to ${shape.toFixed(1)} m from before (near ${where(shapeAt)})` : ''}`);
  const diff = ROUTE_TAGS.filter((k) => (a.tags[k] ?? '') !== (b.tags[k] ?? ''));
  if (diff.length) retagged.push(`- ${link('way', id)}: ${diff.map((k) => `${k} ${a.tags[k] ?? '(none)'} → ${b.tags[k] ?? '(none)'}`).join(', ')}`);
}
for (const [id, b] of W1) if (!W0.has(id) && touches(b)) added.push(`- ${link('way', id)} (${b.tags.highway}${b.tags.name ? `, ${b.tags.name}` : ''}${b.tags.access ? `, access=${b.tags.access}` : ''}), ${b.geometry.length} points, from ${where(b.geometry[0])}`);

// gates: each campus entrance in places.json against the nearest OSM gate or entrance node
const gates = now.elements.filter((x) => x.type === 'node');
const gateRows = world.places.filter((p) => p.category === 'entrance').map((p) => {
  let best = null, bd = Infinity;
  for (const g of gates) { const d = dist(p.position, [g.lon, g.lat]); if (d < bd) { bd = d; best = g; } }
  const ok = bd < 3.05; // (coordinates to 6 decimals: a hair over 3.0 counts as the same spot)
  return `| ${p.name} | ${best ? `${link('node', best.id)} ${best.tags.barrier ?? `entrance=${best.tags.entrance}`}` : '–'} | ${Number.isFinite(bd) ? bd.toFixed(1) : '–'} | ${ok ? 'same spot' : bd <= 25 ? 'over 3 m apart: check' : 'no OSM gate nearby'} |`;
});

const out = `# OSM walking ways: today vs the map's download

Generated by \`node scripts/osm-path-diff.mjs\` on ${new Date().toISOString().slice(0, 10)}. Compares OpenStreetMap now
(Overpass: highway=${KINDS.replaceAll('|', ', ')}; gates and entrances) with the download \`data/paths.json\` was built from,
for ways inside the map's island. Differences over 3 m only. Nothing here is applied automatically.

## Ways that moved (${moved.length})
${moved.join('\n') || 'None.'}

## Ways added in OSM since (${added.length})
${added.join('\n') || 'None.'}

## Ways removed from OSM since (${removed.length})
${removed.join('\n') || 'None.'}

## Tags a route depends on, changed (${retagged.length})
${retagged.join('\n') || 'None.'}

## Campus entrances vs OSM gates
| Entrance (places.json) | Nearest OSM gate/entrance | Metres | |
|---|---|---|---|
${gateRows.join('\n')}
`;
await writeFile(new URL('docs/osm-path-diff.md', ROOT), out);
console.log(`osm-path-diff: ${moved.length} moved, ${added.length} added, ${removed.length} removed, ${retagged.length} retagged; written to docs/osm-path-diff.md`);
