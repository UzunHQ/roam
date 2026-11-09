// A report on a GPS recording made with ?gpslog (docs/GPS.md): how far the readings, and the
// character, were from the mapped footpaths; whether they lean the same way in each part of the
// campus (a systematic lean means the map is off there, a scatter means GPS noise); how accurate
// the phone said they were; and how many fell inside buildings.
// usage: node scripts/gps-report.mjs docs/gps-logs/<file>.json   (or the .gpx: raw readings only)
import { readFile } from 'node:fs/promises';
import { campusWorld, metres, nearSeg, inRing, quantile, dist } from './lib/campus-world.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/gps-report.mjs <log.json | log.gpx>'); process.exit(2); }
const text = await readFile(file, 'utf8');

/** [{ pos: [lng, lat], accuracy, shown: [lng, lat] | null }] */
let points;
if (file.endsWith('.gpx')) {
  const trk = text.split('<trk>')[1] ?? text; // the first track: the raw readings
  points = [...trk.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">(.*?)<\/trkpt>/gs)].map((m) => ({
    pos: [+m[2], +m[1]], accuracy: +(m[3].match(/accuracy (\d+(?:\.\d+)?)/)?.[1] ?? NaN), shown: null,
  }));
} else {
  const j = JSON.parse(text);
  points = (j.entries ?? j).map((e) => ({ pos: [e.lon, e.lat], accuracy: e.accuracy, shown: e.shown ?? null, step: e.step }));
}
if (!points.length) { console.error('no readings in', file); process.exit(1); }

const world = await campusWorld();
const M = metres(world.paths[0][0]);
const segs = world.paths.map(([a, b]) => [M.xy(a), M.xy(b)]);
const rings = world.buildings.map((b) => { const r = b.ring.map((p) => M.xy(p)); return { r, box: [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))] }; });
/** offset from the nearest path point to p, in metres east and north */
function toPath(ll) {
  const p = M.xy(ll);
  let best = { d: Infinity, q: p };
  for (const [a, b] of segs) { const n = nearSeg(p, a, b); if (n.d < best.d) best = n; }
  return { d: best.d, e: p[0] - best.q[0], n: p[1] - best.q[1] };
}
const inside = (ll) => { const p = M.xy(ll); return rings.some(({ r, box }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && inRing(p, r)); };

// the campus's parts, by the nearest place that belongs to one
const REGIONS = { 'digby-stuart': 'Digby Stuart', froebel: 'Froebel', southlands: 'Southlands', whitelands: 'Whitelands' };
const anchors = world.places.filter((p) => p.college || /^chadwick|gate-chadwick/.test(p.id)).map((p) => ({
  pos: p.position, region: /chadwick/.test(p.id) ? 'Chadwick Hall' : REGIONS[p.college],
}));
function region(ll) {
  let best = null, bd = Infinity;
  for (const a of anchors) { const d = dist(ll, a.pos); if (d < bd) { bd = d; best = a.region; } }
  return bd <= 150 && best ? best : 'Elsewhere';
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const stats = (xs) => `median ${f1(quantile(xs, 0.5))} m, 90th percentile ${f1(quantile(xs, 0.9))} m, max ${f1(Math.max(...xs))} m`;

const raw = points.map((p) => ({ ...p, path: toPath(p.pos), region: region(p.pos) }));
const shown = raw.filter((p) => p.shown);
console.log(`# GPS report: ${file}`);
console.log(`${raw.length} readings${shown.length ? `, ${shown.length} shown` : ''}${raw.some((p) => p.step === 'reject') ? `, ${raw.filter((p) => p.step === 'reject').length} dropped as jumps` : ''}.\n`);

console.log('## (a) Distance to the nearest footpath');
console.log(`- raw readings: ${stats(raw.map((p) => p.path.d))}`);
if (shown.length) console.log(`- the character: ${stats(shown.map((p) => toPath(p.shown).d))}`);

console.log('\n## (b) Lean by part of the campus (from the nearest path to the reading)');
console.log('A lean that is large and consistent (near 1) points the same way every time: the map may be off there. Near 0 is scatter: GPS noise.\n');
console.log('| Part | Readings | Mean lean east, north (m) | Size (m) | Mean distance (m) | Consistency |');
console.log('|---|---|---|---|---|---|');
for (const name of [...Object.values(REGIONS).slice(0, 3), 'Chadwick Hall', 'Whitelands', 'Elsewhere']) {
  const rs = raw.filter((p) => p.region === name);
  if (!rs.length) { console.log(`| ${name} | 0 | – | – | – | – |`); continue; }
  const e = rs.reduce((s, p) => s + p.path.e, 0) / rs.length, n = rs.reduce((s, p) => s + p.path.n, 0) / rs.length;
  const md = rs.reduce((s, p) => s + p.path.d, 0) / rs.length, size = Math.hypot(e, n);
  console.log(`| ${name} | ${rs.length} | ${f1(e)}, ${f1(n)} | ${f1(size)} | ${f1(md)} | ${md ? (size / md).toFixed(2) : '–'} |`);
}

console.log('\n## (c) Accuracy the phone reported');
const acc = raw.map((p) => p.accuracy).filter(Number.isFinite);
if (acc.length) {
  console.log(`- ${stats(acc)}, min ${f1(Math.min(...acc))} m`);
  const bands = [[0, 5], [5, 10], [10, 20], [20, 50], [50, Infinity]];
  console.log('- ' + bands.map(([a, b]) => `${b === Infinity ? `over ${a}` : `${a}–${b}`} m: ${Math.round((100 * acc.filter((v) => v > a && v <= b).length) / acc.length)}%`).join(', '));
} else console.log('- not in this file');

console.log('\n## (d) Inside buildings');
console.log(`- raw readings: ${Math.round((100 * raw.filter((p) => inside(p.pos)).length) / raw.length)}%`);
if (shown.length) console.log(`- the character: ${Math.round((100 * shown.filter((p) => inside(p.shown)).length) / shown.length)}%`);
