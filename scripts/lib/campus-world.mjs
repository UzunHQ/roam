// The campus as the GPS filter and the path checks see it: the walking graph's segments
// (data/paths.json) and the building outlines (data/campus.geojson), named after the place that
// owns each one (data/places.json) where there is one.
import { readFile } from 'node:fs/promises';

const read = async (f) => JSON.parse(await readFile(new URL(`../../data/${f}`, import.meta.url), 'utf8'));

export async function campusWorld() {
  const [graph, campus, doc] = await Promise.all([read('paths.json'), read('campus.geojson'), read('places.json')]);
  const owner = new Map();
  for (const p of doc.places) if (p.footprintId && !owner.has(p.footprintId)) owner.set(p.footprintId, p.name);
  const buildings = [];
  for (const f of campus.features) {
    const pr = f.properties ?? {};
    if (pr.layer !== 'building' || f.geometry?.type !== 'Polygon') continue;
    buildings.push({ id: pr.osmId, name: owner.get(pr.osmId) ?? null, campus: !!pr.campus || owner.has(pr.osmId), ring: f.geometry.coordinates[0], props: pr });
  }
  const paths = graph.edges.map(([a, b]) => [graph.nodes[a], graph.nodes[b]]);
  return { graph, campus, doc, places: doc.places, buildings, paths };
}

// ---------- small geometry, in metres around a point ----------
export const R = 111320;
export const metres = (o) => {
  const kx = R * Math.cos((o[1] * Math.PI) / 180);
  return { xy: (p) => [(p[0] - o[0]) * kx, (p[1] - o[1]) * R], ll: ([x, y]) => [o[0] + x / kx, o[1] + y / R] };
};
export const dist = (a, b) => Math.hypot((a[0] - b[0]) * R * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * R);
/** nearest point on segment ab to p, all [x, y] in metres */
export function nearSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  const q = [a[0] + u * dx, a[1] + u * dy];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), u };
}
export function inRing(p, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
export const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))] : NaN; };
