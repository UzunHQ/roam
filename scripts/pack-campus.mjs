// Packs data/campus.geojson (the source every build script reads and writes) into
// data/campus.app.json, the file the app downloads. Nothing visible changes:
// - the ~2,000 trees become one "treepack" feature: [lng, lat] in millionths of a degree, each a
//   delta from the one before (sorted west to east), size x10 and a flags number (unpacked by
//   src/data.ts unpackCampus);
// - the surroundings' building outlines (context, not the university's) are simplified to within
//   0.4 m (the campus's own buildings stay exact);
// - coordinates stay at 6 decimals (about 0.1 m).
// Runs as part of `npm run build` and `npm run dev`, so the app file always matches the source.
import { readFile, writeFile } from 'node:fs/promises';

const SRC = new URL('../data/campus.geojson', import.meta.url);
const OUT = new URL('../data/campus.app.json', import.meta.url);
const TOL_M = 0.4;

const fc = JSON.parse(await readFile(SRC, 'utf8'));

function simplifyRing(ring) {
  if (ring.length < 6) return ring;
  const lat0 = ring[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
  const xy = ring.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // a closed ring: split at the point farthest from the first, so the two halves simplify well
  let far = 1, fd = 0;
  for (let i = 1; i < ring.length - 1; i++) { const d = Math.hypot(xy[i][0] - xy[0][0], xy[i][1] - xy[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[far] = 1;
  const stack = [[0, far], [far, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let worst = -1, wd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = L ? Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / L : Math.hypot(xy[i][0] - ax, xy[i][1] - ay);
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0 && wd > TOL_M) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

const trees = [];
const features = [];
let ptsBefore = 0, ptsAfter = 0;
for (const f of fc.features) {
  const p = f.properties ?? {};
  if (p.layer === 'tree' && f.geometry?.type === 'Point') {
    const known = new Set(['layer', 'generated', 'context', 'ctx', 'belt', 's']);
    if (Object.keys(p).every((k) => known.has(k))) { trees.push(f); continue; }
  }
  if (p.layer === 'building' && p.context && !p.campus && f.geometry?.type === 'Polygon') {
    ptsBefore += f.geometry.coordinates.reduce((n, r) => n + r.length, 0);
    f.geometry.coordinates = f.geometry.coordinates.map(simplifyRing);
    ptsAfter += f.geometry.coordinates.reduce((n, r) => n + r.length, 0);
  }
  features.push(f);
}
trees.sort((a, b) => a.geometry.coordinates[0] - b.geometry.coordinates[0] || a.geometry.coordinates[1] - b.geometry.coordinates[1]);
const pts = [], s = [], fl = [];
let px = 0, py = 0;
for (const t of trees) {
  const x = Math.round(t.geometry.coordinates[0] * 1e6), y = Math.round(t.geometry.coordinates[1] * 1e6);
  pts.push(x - px, y - py); px = x; py = y;
  const p = t.properties;
  s.push(p.s ? Math.round(p.s * 10) : 0);
  fl.push((p.generated ? 1 : 0) | (p.context ? 2 : 0) | (p.ctx ? 4 : 0) | (p.belt ? 8 : 0));
}
features.push({ type: 'Feature', properties: { layer: 'treepack', pts, s, f: fl }, geometry: null });

const round = (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
const out = JSON.stringify({ ...fc, features }, round);
await writeFile(OUT, out);
const before = JSON.stringify(fc).length;
console.log(`campus.app.json: ${(out.length / 1024).toFixed(0)} KB (source ${(before / 1024).toFixed(0)} KB); ${trees.length} trees packed; surroundings' outlines ${ptsBefore} -> ${ptsAfter} points`);
