// Checks the walking graph (data/paths.json) the routes use:
// 1. it is all one piece;
// 2. no path runs through a building (a mapped passage or tunnel is fine: listed in
//    data/paths-known.json with its OSM tag);
// 3. dead ends on the campus grounds lead somewhere (a door, a building, a place, the map's edge);
//    the ones left are listed in data/paths-known.json with a reason, or the check fails;
// 4. every campus entrance and every place's door is on the graph (a node within 25 m);
// 5. between the Library, the Students' Union, Chadwick Hall South, Whitelands and the Main
//    entrance, every pair has a route, no longer than 2.2 times the straight line.
// usage: node scripts/check-paths.mjs [--list]   (--list prints every finding, known or not)
import { readFile } from 'node:fs/promises';
import { loadTs } from './lib/load-ts.mjs';
import { campusWorld, metres, nearSeg, inRing, dist } from './lib/campus-world.mjs';

const LIST = process.argv.includes('--list');
const known = JSON.parse(await readFile(new URL('../data/paths-known.json', import.meta.url), 'utf8'));
const { Router } = await loadTs('../../src/route.ts');
const world = await campusWorld();
const g = world.graph;
const M = metres(g.nodes[0]);
const N = g.nodes.map((p) => M.xy(p));
const B = world.buildings.map((b) => ({ ...b, r: b.ring.map((p) => M.xy(p)) }));
const key = (ll) => `${ll[0].toFixed(5)},${ll[1].toFixed(5)}`;
let failed = 0;
const report = (name, problems, knownKeys = new Set()) => {
  const fresh = problems.filter((p) => !knownKeys.has(p.key));
  const listed = problems.length - fresh.length;
  if (fresh.length) failed++;
  console.log(`${fresh.length ? 'FAIL' : 'ok  '} ${name}: ${fresh.length} new${listed ? `, ${listed} known (data/paths-known.json)` : ''}`);
  for (const p of LIST ? problems : fresh) console.log(`       ${knownKeys.has(p.key) ? '(known) ' : ''}${p.text}  [${p.key}]`);
  const stale = [...knownKeys].filter((k) => !problems.some((p) => p.key === k));
  for (const k of stale) console.log(`       note: ${k} is listed as known but no longer found: remove it from data/paths-known.json`);
};

// 1. one piece
{
  const adj = N.map(() => []);
  for (const [a, b] of g.edges) { adj[a].push(b); adj[b].push(a); }
  const seen = new Uint8Array(N.length);
  let parts = 0;
  const sizes = [];
  for (let s = 0; s < N.length; s++) {
    if (seen[s]) continue;
    parts++;
    let n = 0;
    const st = [s]; seen[s] = 1;
    while (st.length) { const x = st.pop(); n++; for (const y of adj[x]) if (!seen[y]) { seen[y] = 1; st.push(y); } }
    sizes.push(n);
  }
  report('the graph is one piece', parts > 1 ? sizes.sort((a, b) => b - a).slice(1).map((n, i) => ({ key: `piece-${i}`, text: `a separate piece of ${n} nodes` })) : []);
}

// 2. paths through buildings (more than 1.5 m of an edge inside an outline)
{
  const problems = [];
  const seen = new Set();
  g.edges.forEach(([a, b, d]) => {
    for (const bl of B) {
      let ins = 0;
      for (let k = 1; k < 20; k++) { const t = k / 20; if (inRing([N[a][0] + (N[b][0] - N[a][0]) * t, N[a][1] + (N[b][1] - N[a][1]) * t], bl.r)) ins++; }
      const inside = (ins / 19) * d;
      if (inside <= 1.5) continue;
      const k = `${bl.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      problems.push({ key: k, text: `through ${bl.name ?? `an unnamed building (${bl.props.building})`} (${bl.id}), ${inside.toFixed(1)} m inside, near ${key(g.nodes[a])}` });
    }
  });
  report('no path runs through a building', problems, new Set(Object.keys(known.throughBuildings ?? {})));
}

// 3. dead ends on the campus grounds that lead nowhere
{
  const ground = world.campus.features.filter((f) => f.properties?.layer === 'campusground').flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]))).map((r) => r.map((p) => M.xy(p)));
  const zone = world.campus.features.find((f) => f.properties?.layer === 'contextzone');
  const zr = zone.geometry.coordinates.map((p) => p[0].map((q) => M.xy(q)));
  const edgeDist = (p, rings) => Math.min(...rings.map((r) => Math.min(...r.slice(1).map((q, i) => nearSeg(p, r[i], q).d))));
  const spots = world.places.flatMap((p) => [p.position, ...(p.entrances ?? []).map((e) => e.pos), ...(p.entrance ? [p.entrance] : [])]).map((q) => M.xy(q));
  const deg = new Array(N.length).fill(0);
  for (const [a, b] of g.edges) { deg[a]++; deg[b]++; }
  const problems = [];
  deg.forEach((d, i) => {
    if (d !== 1) return;
    const p = N[i];
    if (!ground.some((r) => inRing(p, r))) return; // off the grounds: the streets and estates around are OSM's business
    if (Math.min(...B.map((bl) => Math.min(...bl.r.slice(1).map((q, j) => nearSeg(p, bl.r[j], q).d)))) <= 4) return; // at a building: its door
    if (spots.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= 15)) return; // at a place or a door
    if (edgeDist(p, zr) <= 25) return; // goes on past the map's edge
    problems.push({ key: key(g.nodes[i]), text: `a dead end at ${key(g.nodes[i])}` });
  });
  report('dead ends on the campus lead somewhere', problems, new Set(Object.keys(known.deadEnds ?? {})));
}

// 4. entrances and doors on the graph
{
  const problems = [];
  const nearest = (ll) => { const p = M.xy(ll); let bd = Infinity; for (const q of N) bd = Math.min(bd, Math.hypot(q[0] - p[0], q[1] - p[1])); return bd; };
  for (const p of world.places) {
    const doors = [...(p.entrances ?? []).filter((e) => e.type !== 'closed').map((e) => e.pos), ...(p.entrance ? [p.entrance] : [])];
    const pts = p.category === 'entrance' ? [p.position] : doors;
    for (const q of pts) {
      const d = nearest(q);
      if (d > 25) problems.push({ key: `${p.id}@${key(q)}`, text: `${p.name}: ${p.category === 'entrance' ? 'the entrance' : 'a door'} is ${d.toFixed(0)} m from the nearest path node` });
    }
  }
  report('every entrance and door is on the graph (within 25 m)', problems, new Set(Object.keys(known.offGraph ?? {})));
}

// 5. routes between the main spots, and how direct they are
{
  const router = new Router(g);
  const fp = new Map(world.buildings.map((b) => [b.id, b.ring]));
  const byId = new Map(world.places.map((p) => [p.id, p]));
  const ids = ['library', 'students-union', 'chadwick-hall-south', 'whitelands-college', 'gate-main'];
  const problems = [];
  const rows = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = byId.get(ids[i]), b = byId.get(ids[j]);
    const r = router.route(a, b, fp);
    const straight = dist(a.position, b.position);
    if (!r) { problems.push({ key: `${a.id}>${b.id}`, text: `no route from ${a.name} to ${b.name}` }); continue; }
    const k = r.distanceM / straight;
    rows.push(`${a.name} → ${b.name}: ${Math.round(r.distanceM)} m along paths, ${Math.round(straight)} m straight, ×${k.toFixed(2)}`);
    if (k > 2.2) problems.push({ key: `${a.id}>${b.id}`, text: `${a.name} → ${b.name} is ${k.toFixed(2)} times the straight line` });
  }
  report('routes between the main spots, at most 2.2 times the straight line', problems);
  for (const r of rows) console.log(`       ${r}`);
}

console.log(failed ? `check:paths: ${failed} failed` : 'check:paths: all passed');
process.exit(failed ? 1 : 0);
