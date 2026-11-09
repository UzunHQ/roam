// The GPS filter (src/gps.ts) against synthetic walks on the real campus paths and buildings.
// Each case has a pass mark; the "before" column is what the app did until now (every raw reading
// shown as it came, arrival from a single raw reading). The noise is made up (seeded Gaussian per
// axis), not measured: real logs go in docs/gps-logs/ (docs/GPS.md).
// usage: node scripts/check-gps.mjs [--json out.json]   (exits 1 on any failure)
import { writeFile } from 'node:fs/promises';
import { loadTs } from './lib/load-ts.mjs';
import { campusWorld, metres, dist, nearSeg, quantile, inRing } from './lib/campus-world.mjs';

const { GpsFilter, nearEnd } = await loadTs('../../src/gps.ts');
const { Router } = await loadTs('../../src/route.ts');
const world = await campusWorld();
const router = new Router(world.graph);
const byId = new Map(world.places.map((p) => [p.id, p]));
const footprints = new Map(world.buildings.map((b) => [b.id, b.ring]));

// seeded randomness
let seed = 12345;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const M = metres(world.paths[0][0]);
const jitter = (p, sigma) => { const [x, y] = M.xy(p); return M.ll([x + gauss() * sigma, y + gauss() * sigma]); };

/** points every `step` metres along a line, at 1.3 m/s, one reading a second */
function walkLine(line, speed = 1.3) {
  const out = [line[0]];
  let need = speed;
  for (let i = 1; i < line.length; i++) {
    let a = line[i - 1];
    const b = line[i];
    let d = dist(a, b);
    while (d >= need) {
      const t = need / d;
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(a); d -= need; need = speed;
    }
    need -= d;
  }
  return out;
}
const distToLine = (p, line) => {
  const xy = M.xy(p);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, nearSeg(xy, M.xy(line[i - 1]), M.xy(line[i])).d);
  return best;
};
const travel = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
const route = (from, to) => {
  const r = router.route(byId.get(from).position, byId.get(to), footprints);
  if (!r) throw new Error(`no route ${from} -> ${to}`);
  return r.coordinates;
};

let failed = 0;
const rows = [];
const check = (name, before, after, pass, unit = '') => {
  if (!pass) failed++;
  rows.push({ name, before, after, pass });
  const f = (v) => (typeof v === 'number' ? `${Math.round(v * 10) / 10}${unit}` : String(v));
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}: before ${f(before)}, after ${f(after)}`);
};
/** runs readings through a new filter; returns what was shown at each */
function run(readings, { routeLine = null } = {}) {
  const f = new GpsFilter({ paths: world.paths, buildings: world.buildings });
  f.setRoute(routeLine);
  return readings.map((r) => ({ r, step: f.push(r) }));
}
const shownOf = (steps) => {
  let last = null;
  return steps.map(({ step }) => (step.kind === 'show' ? (last = step.view.shown) : last));
};

// 1. walking along paths, ±8 m of noise (RMS 8 m: 5.7 m per axis), reported accuracy 8–12 m
{
  const lines = [route('library', 'students-union'), route('gate-main', 'library'), route('chadwick-hall-south', 'gate-froebel')];
  for (const phone of [false, true]) {
    const before = [], after = [], afterRoute = [], lagB = [], lagA = [];
    for (const line of lines) {
      const truth = walkLine(line);
      // with the phone's own speed and course (most phones give them outdoors), or without
      const readings = truth.map((p, i) => {
        const nxt = truth[Math.min(i + 1, truth.length - 1)], [ax, ay] = M.xy(p), [bx, by] = M.xy(nxt);
        const h = ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360 + gauss() * 10) % 360;
        return { pos: jitter(p, 5.66), accuracy: 8 + rnd() * 4, heading: phone ? h : null, speed: phone ? 1.3 + gauss() * 0.2 : null, time: i * 1000 };
      });
      readings.forEach((r, i) => { before.push(distToLine(r.pos, line)); lagB.push(dist(r.pos, truth[i])); });
      shownOf(run(readings)).forEach((s, i) => { if (s) { after.push(distToLine(s, line)); lagA.push(dist(s, truth[i])); } });
      shownOf(run(readings, { routeLine: line })).forEach((s) => s && afterRoute.push(distToLine(s, line)));
    }
    const w = phone ? "with the phone's speed" : 'no speed from the phone';
    check(`walking, ±8 m noise, ${w}: median distance to the path walked`, quantile(before, 0.5), quantile(after, 0.5), quantile(after, 0.5) < 3, ' m');
    check(`walking, ±8 m noise, ${w}: 90th percentile`, quantile(before, 0.9), quantile(after, 0.9), true, ' m');
    check(`walking, ±8 m noise, ${w}: median distance from the true position (info)`, quantile(lagB, 0.5), quantile(lagA, 0.5), true, ' m');
    check(`walking a shown route, ±8 m noise, ${w}: median distance to the route`, quantile(before, 0.5), quantile(afterRoute, 0.5), quantile(afterRoute, 0.5) < 3, ' m');
  }
}

// 2. standing still for 2 minutes, ±10 m of noise (7.1 m per axis), on a path and on a lawn
for (const [where, at] of [['on a path', world.graph.nodes[world.graph.edges[400][0]]], ['on a lawn', null]]) {
  let spot = at;
  if (!spot) {
    // a point at least 15 m from any path and outside every building, near the library
    const lib = byId.get('library').position;
    for (let k = 0; k < 2000 && !spot; k++) {
      const c = M.ll([M.xy(lib)[0] + (rnd() - 0.5) * 300, M.xy(lib)[1] + (rnd() - 0.5) * 300]);
      const far = world.paths.every(([a, b]) => nearSeg(M.xy(c), M.xy(a), M.xy(b)).d > 15);
      const out = world.buildings.every((b) => !inRing(M.xy(c), b.ring.map((p) => M.xy(p))));
      if (far && out) spot = c;
    }
  }
  // 50 different noise draws: the worst one counts
  const before = [], after = [];
  for (let k = 0; k < 50; k++) {
    const readings = Array.from({ length: 120 }, (_, i) => ({ pos: jitter(spot, 7.07), accuracy: 10 + rnd() * 5, heading: null, speed: null, time: i * 1000 }));
    before.push(travel(readings.map((r) => r.pos)));
    after.push(travel(shownOf(run(readings)).filter(Boolean)));
  }
  check(`standing 2 min ${where}, ±10 m noise: how far the character moves in all (worst of 50)`, Math.max(...before), Math.max(...after), Math.max(...after) < 2, ' m');
}

// how long the character waits before following someone who sets off (info: the price of 2.)
for (const phone of [false, true]) {
  const lags = [];
  for (let k = 0; k < 50; k++) {
    const f = new GpsFilter({ paths: [], buildings: [] });
    let first = null, t = null;
    for (let i = 0; i < 60 && t == null; i++) {
      const st = f.push({ pos: M.ll([i * 1.3 + gauss() * 5.66, gauss() * 5.66]), accuracy: 8 + rnd() * 4, heading: phone ? 90 : null, speed: phone ? 1.3 : null, time: i * 1000 });
      if (st.kind !== 'show') continue;
      const x = M.xy(st.view.shown)[0];
      if (first == null) first = x; else if (Math.abs(x - first) > 3) t = i;
    }
    lags.push(t ?? 60);
  }
  check(`setting off, ±8 m noise, ${phone ? "with the phone's speed" : 'no speed from the phone'}: seconds before the character follows (median, info)`, 1, quantile(lags, 0.5), true, ' s');
}

// 3. one reading 200 m off while walking
{
  const line = route('library', 'students-union'), truth = walkLine(line);
  const readings = truth.map((p, i) => ({ pos: jitter(p, 3), accuracy: 6 + rnd() * 3, heading: null, speed: null, time: i * 1000 }));
  const k = 60, [x, y] = M.xy(readings[k].pos);
  readings[k] = { ...readings[k], pos: M.ll([x + 160, y + 120]), accuracy: 15 };
  const steps = run(readings), shown = shownOf(steps);
  // around the jump: how far the character is from the truth
  const worst = Math.max(...shown.slice(k - 2, k + 6).map((s, i) => dist(s, truth[k - 2 + i])));
  check('a single 200 m jump: dropped (worst distance from the truth around it)', 200, worst, steps[k].step.kind === 'reject' && worst < 15, ' m');
  // but two readings the same way are a real move (GPS caught up after a gap)
  const moved = readings.slice(0, 40).concat(readings.slice(40).map((r) => ({ ...r, pos: M.ll([M.xy(r.pos)[0] + 160, M.xy(r.pos)[1] + 120]) })));
  const s2 = run(moved);
  check('a real move (two readings the same way): followed', 'yes', s2[41].step.kind === 'show' ? 'yes' : 'no', s2[41].step.kind === 'show');
}

// 4. walking into a building with weak readings (accuracy 35 m)
{
  const lib = world.buildings.find((b) => b.id === byId.get('library').footprintId);
  const xs = lib.ring.map((p) => M.xy(p));
  const c = M.ll([xs.reduce((s, p) => s + p[0], 0) / xs.length, xs.reduce((s, p) => s + p[1], 0) / xs.length]);
  const path = route('students-union', 'library');
  const truth = walkLine([...path, c]);
  const inside = Array.from({ length: 90 }, () => c);
  const all = [...truth, ...inside];
  const readings = all.map((p, i) => ({ pos: jitter(p, i < truth.length ? 4 : 8), accuracy: i < truth.length ? 10 : 35, heading: null, speed: null, time: i * 1000 }));
  const steps = run(readings), shown = shownOf(steps);
  const inShown = shown.slice(truth.length + 5);
  const before = travel(readings.slice(truth.length + 5).map((r) => r.pos));
  const after = travel(inShown);
  const label = steps[steps.length - 1].step.view?.inside;
  check('inside a building, accuracy 35 m: how far the character wanders inside', before, after, after < 2 && label === 'Library', ' m');
  console.log(`     (shows "Inside ${label}")`);
}

// 5. starting with a 40 m reading
{
  const truth = byId.get('library').position;
  const f = new GpsFilter({ paths: world.paths, buildings: world.buildings });
  const [x, y] = M.xy(truth);
  const a = f.push({ pos: M.ll([x + 30, y + 20]), accuracy: 40, heading: null, speed: null, time: 0 });
  const b = f.push({ pos: jitter(truth, 2), accuracy: 8, heading: null, speed: null, time: 1500 });
  const d = b.kind === 'show' ? dist(b.view.shown, truth) : Infinity;
  check('first reading 40 m: waits, then uses the better one', 36, d, a.kind === 'wait' && d < 10, ' m');
  // none better within 4 s: the best so far, then the better one when it comes
  const g = new GpsFilter({ paths: world.paths, buildings: world.buildings });
  const steps = [0, 1000, 2000, 3000, 4000].map((t) => g.push({ pos: M.ll([x + 30, y + 20]), accuracy: 40, heading: null, speed: 0, time: t }));
  // (at most 12 m a reading: it gets there over a few seconds rather than in one leap)
  const later = [5000, 6000, 7000, 8000].map((t) => g.push({ pos: jitter(truth, 2), accuracy: 8, heading: null, speed: 0, time: t }));
  const d2 = later[3].kind === 'show' ? dist(later[3].view.shown, truth) : Infinity;
  check('only 40 m readings for 4 s: shown, then moves to the better one within 4 s', 36, d2, steps[3].kind === 'wait' && steps[4].kind === 'show' && d2 < 10, ' m');
}

// 6. standing 40 m before the end of a route, noisy: arrival must not fire; walking in, it must
{
  const line = route('gate-main', 'library'), end = line[line.length - 1];
  // the point 40 m before the end along the route
  let back = 40, i = line.length - 1, spot = end;
  while (i > 0) { const d = dist(line[i - 1], line[i]); if (d >= back) { const t = back / d; spot = [line[i][0] + (line[i - 1][0] - line[i][0]) * t, line[i][1] + (line[i - 1][1] - line[i][1]) * t]; break; } back -= d; i--; }
  const readings = Array.from({ length: 120 }, (_, k) => ({ pos: jitter(spot, 10), accuracy: 20 + rnd() * 10, heading: null, speed: null, time: k * 1000 }));
  // before: one raw reading within max(12 m, its accuracy) of the end, accuracy 30 m or better
  const oldRule = (r) => r.accuracy <= 30 && dist(r.pos, end) <= Math.max(12, r.accuracy);
  const before = readings.filter(oldRule).length;
  let after = 0, streak = 0;
  for (const { step } of run(readings, { routeLine: line })) {
    if (step.kind !== 'show') continue;
    streak = nearEnd(step.view.fix, end) ? streak + 1 : 0;
    if (streak >= 2) after++;
  }
  check('waiting 40 m before the end, ±10 m noise: false arrivals in 2 min', before, after, after === 0);
  const walkIn = walkLine(line).map((p, k) => ({ pos: jitter(p, 4), accuracy: 8 + rnd() * 4, heading: null, speed: null, time: k * 1000 }));
  walkIn.push(...Array.from({ length: 10 }, (_, k) => ({ pos: jitter(end, 4), accuracy: 8, heading: null, speed: null, time: (walkIn.length + k) * 1000 })));
  let arrived = false; streak = 0;
  for (const { step } of run(walkIn, { routeLine: line })) {
    if (step.kind !== 'show') continue;
    streak = nearEnd(step.view.fix, end) ? streak + 1 : 0;
    if (streak >= 2) arrived = true;
  }
  check('walking all the way in: arrival fires', 'yes', arrived ? 'yes' : 'no', arrived);
}

const out = process.argv.indexOf('--json');
if (out > 0) await writeFile(process.argv[out + 1], JSON.stringify(rows, null, 1));
console.log(failed ? `check:gps: ${failed} failed` : 'check:gps: all passed');
process.exit(failed ? 1 : 0);
