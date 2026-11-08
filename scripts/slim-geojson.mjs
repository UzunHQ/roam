// Makes data/campus.geojson smaller without visible change: coordinates to 6 decimals (about
// 0.1 m), and the long outlines of the golf course, lawns, paths and water simplified to within
// 0.3 m. Building footprints, trees and small features are left exactly as they are.
// Runs after build-campus (npm run build:campus); safe to run again on an already slim file.
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../data/campus.geojson', import.meta.url);
const SIMPLIFY = new Set(['golf', 'green', 'path', 'water', 'flowerbed', 'waterway', 'parking']);
const TOL_M = 0.3;

const before = await readFile(FILE, 'utf8');
const fc = JSON.parse(before);

function simplify(line) {
  if (line.length < 4) return line;
  const lat0 = line[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
  const xy = line.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
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
  const out = line.filter((_, i) => keep[i]);
  return out.length >= 4 || line[0][0] !== line[line.length - 1][0] ? out : line; // a ring keeps at least 4 points
}

let pointsBefore = 0, pointsAfter = 0;
for (const f of fc.features) {
  if (!SIMPLIFY.has(f.properties?.layer)) continue;
  const g = f.geometry;
  const count = (c) => (typeof c[0] === 'number' ? 1 : c.reduce((n, x) => n + count(x), 0));
  pointsBefore += count(g.coordinates);
  if (g.type === 'LineString') g.coordinates = simplify(g.coordinates);
  else if (g.type === 'Polygon') g.coordinates = g.coordinates.map(simplify);
  else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map((p) => p.map(simplify));
  else if (g.type === 'MultiLineString') g.coordinates = g.coordinates.map(simplify);
  pointsAfter += count(g.coordinates);
}

const round = (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
const after = JSON.stringify(fc, round);
await writeFile(FILE, after);
console.log(`campus.geojson: ${(before.length / 1024).toFixed(0)} KB -> ${(after.length / 1024).toFixed(0)} KB; simplified outlines ${pointsBefore} -> ${pointsAfter} points`);
