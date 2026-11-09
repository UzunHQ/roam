// The opening view's camera study (docs/camera-candidates/README.md): 180 candidate cameras at each
// screen size, each scored on (a)-(f); the top three photographed, every score in scores.json.
// Needs the dev server (`npm run dev`, which exposes roamDebug.cam) and Playwright, which isn't a
// dependency of the app: `npm i --no-save playwright-core` and a Chromium (`npx playwright-core install chromium`).
// usage: node scripts/camera-study.mjs http://localhost:5173 OUTDIR [375x812,390x844,768x1024,1440x900] [light|dark]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const browser = () => chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function page(b, w, h, opts = {}) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...(w < 600 ? { isMobile: true, hasTouch: true } : {}), ...opts });
  return c.newPage();
}
const [BASE, OUT, SIZES = '375x812,390x844,768x1024,1440x900', SCHEME = 'light'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const AXIS = 25; // the main campus's long axis, degrees east of north (principal axis of its buildings)
const SHIFTS = [[0, 0], [60, 0], [-60, 0], [0, 50], [0, -50]]; // [fwd, side] metres: up the screen, to the right
const DZ = [-0.2, 0, 0.25, 0.5];
const PITCH = [40, 50, 60];
const bearingsFor = (w, h) => (w > h ? [-25, -10, 10] : [AXIS - 35, AXIS - 15, AXIS]);

// runs in the page: the scores for whatever the camera shows now
const measure = () => {
  const m = window.map, D = window.__study;
  const W = innerWidth, H = innerHeight;
  const ui = ['.top', '#chips', '.controls', '#key-btn', '#welcome', '.footer', '#panel']
    .map((s) => document.querySelector(s)).filter((e) => e && !e.hidden && e.offsetParent !== null)
    .map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
  const covered = (x, y) => ui.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  const pip = (pt, ring) => { let i = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xi, yi] = ring[a], [xj, yj] = ring[b]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) i = !i; } return i; };
  const inAny = (pt, polys) => polys.some((p) => pip(pt, p[0]) && !p.slice(1).some((h) => pip(pt, h)));
  // (a) the four areas whole and clear of the controls, cards and search
  const vis = {};
  for (const [k, rings] of Object.entries(D.areas)) {
    let ok = 0, n = 0;
    for (const ring of rings) for (const q of ring) { n++; const p = m.project(q); if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H && !covered(p.x, p.y)) ok++; }
    vis[k] = ok / n;
  }
  // (b)-(d) a grid over the screen: what ground each spot shows
  let N = 0, main = 0, golf = 0, emptyTop = 0, free = 0, inHull = 0;
  let top = Infinity;
  for (const ring of D.mainRings) for (const q of ring) top = Math.min(top, m.project(q).y);
  top = Math.max(0, top);
  for (let y = 3; y < H; y += 8) for (let x = 3; x < W; x += 8) {
    N++;
    const ll = m.unproject([x, y]); const pt = [ll.lng, ll.lat];
    const g = pip(pt, D.golf);
    if (g) golf++;
    else if (inAny(pt, D.main)) main++;
    if (y < top && !covered(x, y) && !inAny(pt, D.island)) emptyTop++; // (empty ground you can see: not what's under the search)
    if (!covered(x, y)) { free++; if (pip(pt, D.hull)) inHull++; }
  }
  // (e) names and pins that overlap
  const isVis = (e) => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && +s.opacity > 0.05 && s.display !== 'none'; };
  const onScr = (r) => r.width && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
  const labels = [...document.querySelectorAll('.pin.show-label .label, .pin.selected .label, .area-label:not(.hidden)')].filter(isVis).map((e) => e.getBoundingClientRect()).filter(onScr);
  const dots = [...document.querySelectorAll('.pin:not(.hidden) .dot, .pin:not(.hidden) .gate')].filter(isVis).map((e) => e.getBoundingClientRect()).filter(onScr);
  const ov = (a, c, pad) => a.left < c.right - pad && c.left < a.right - pad && a.top < c.bottom - pad && c.top < a.bottom - pad;
  let labelHits = 0, dotHits = 0;
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (ov(labels[i], labels[j], 1)) labelHits++;
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) if (ov(dots[i], dots[j], 3)) dotHits++;
  // (f) the hospital's H
  const h = document.querySelector('.pin.k-hospital:not(.hidden) .dot');
  const hr = h?.getBoundingClientRect();
  const hVis = !!hr && onScr(hr) && !covered(hr.left + hr.width / 2, hr.top + hr.height / 2);
  return { vis, b: inHull / free, bStrict: main / N, c: golf / N, d: emptyTop / N, labelHits, dotHits, hVis, zoom: m.getZoom(), pins: dots.length };
};

const score = (r) => {
  const minVis = Math.min(...Object.values(r.vis));
  const a = minVis >= 0.999;
  const e = r.labelHits + r.dotHits;
  const pts = 30 * (a ? 1 : 0) + 10 * minVis
    + 20 * Math.min(1, r.b / 0.55)
    + 15 * (r.c <= 0.2 ? 1 : Math.max(0, 1 - (r.c - 0.2) / 0.2))
    + 15 * (r.d <= 0.1 ? 1 : Math.max(0, 1 - (r.d - 0.1) / 0.1))
    + 10 * (e === 0 ? 1 : Math.max(0, 1 - e / 5))
    + 5 * (r.hVis ? 1 : 0);
  const pass = { a, b: r.b >= 0.55, c: r.c <= 0.2, d: r.d <= 0.1, e: e === 0, f: r.hVis };
  return { pts: Math.round(pts * 10) / 10, pass, passN: ['a', 'b', 'c', 'd', 'e'].filter((k) => pass[k]).length };
};

const b = await browser();
const all = {};
for (const size of SIZES.split(',')) {
  const [w, h] = size.split('x').map(Number);
  const p = await page(b, w, h, { colorScheme: SCHEME });
  await p.goto(BASE + '/?notrack'); await p.waitForSelector('#loading', { state: 'hidden', timeout: 60000 }); await p.waitForTimeout(2500);
  // the study's geometry, from the same data the app draws
  await p.evaluate(async () => {
    const c = await (await fetch('/data/campus.geojson')).json();
    const polys = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
    const ground = c.features.filter((f) => f.properties.layer === 'campusground' && f.properties.name !== 'whitelands');
    const golfPts = c.features.filter((f) => f.properties.layer === 'golf' || f.properties.layer === 'golfflag' || f.id === 'way/4268543')
      .flatMap((f) => (f.geometry.type === 'Point' ? [f.geometry.coordinates] : polys(f).flatMap((p) => p[0])));
    // the golf course: the convex hull of its fairways, greens, bunkers, flags and its strip of ground
    const hull = (P) => { P = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
    const isChad = (f) => /^chadwick-hall|^downshire/.test(f.properties.placeId ?? '') || ['way/451250763', 'way/451250764', 'way/451250765', 'way/451250762'].includes(f.properties.osmId);
    const bld = c.features.filter((f) => f.properties.layer === 'building' && f.properties.campus && f.geometry.type === 'Polygon');
    const areas = { southlands: [], 'digby-stuart': [], froebel: [], chadwick: [] };
    for (const f of bld) { const k = isChad(f) ? 'chadwick' : f.properties.college; if (areas[k]) areas[k].push(f.geometry.coordinates[0]); }
    window.__study = {
      golf: hull(golfPts),
      main: ground.flatMap(polys),
      mainRings: Object.values(areas).flat(),
      // the main campus's region: the outline round the four areas' buildings
      hull: hull(Object.values(areas).flat().flat()),
      island: c.features.filter((f) => f.properties.layer === 'contextzone').flatMap(polys),
      areas,
    };
  });
  const rows = [];
  let i = 0;
  for (const [fwd, side] of SHIFTS) for (const dz of DZ) for (const pitch of PITCH) for (const bearing of bearingsFor(w, h)) {
    const cam = { pitch, bearing, dz, fwd, side };
    await p.evaluate((c) => window.roamDebug.cam(c), cam);
    await p.waitForTimeout(260);
    const r = await p.evaluate(measure);
    const s = score(r);
    rows.push({ id: `${w}-${String(++i).padStart(3, '0')}`, cam, ...r, ...s });
  }
  rows.sort((a, b) => b.pts - a.pts);
  all[size] = rows;
  // the top three, photographed
  for (const [k, r] of rows.slice(0, 3).entries()) {
    await p.evaluate((c) => window.roamDebug.cam(c), r.cam);
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${OUT}/${w}x${h}-${k + 1}-${r.id}.png` });
  }
  console.log(size, 'best', JSON.stringify(rows.slice(0, 3).map((r) => ({ id: r.id, cam: r.cam, pts: r.pts, b: +r.b.toFixed(2), bs: +r.bStrict.toFixed(2), c: +r.c.toFixed(2), d: +r.d.toFixed(2), vis: Object.fromEntries(Object.entries(r.vis).map(([k, v]) => [k, +v.toFixed(2)])), e: r.labelHits + r.dotHits, H: r.hVis }))));
  await p.context().close();
}
fs.writeFileSync(`${OUT}/scores.json`, JSON.stringify(all, null, 1));
await b.close();
