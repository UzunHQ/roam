// Smoke tests in a real browser: the map loads with no errors, search, links, categories, the card,
// directions, and the pins: names that never overlap, and no pin hopping back and forth as you pan.
// Needs the dev server (`npm run dev`: it exposes window.map for the pin tests) and a Chrome or
// Chromium: `npx playwright-core install chromium`, or CHROME=/path/to/chrome.
// usage: node scripts/smoke.mjs [http://localhost:5173]   (exits 1 on any failure)
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

async function open(size, path = '/', { welcomed = true } = {}) {
  const [w, h] = size;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...(w < 600 ? { isMobile: true, hasTouch: true } : {}) });
  if (welcomed) await ctx.addInitScript(() => { try { localStorage.setItem('roam.welcomed', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errors = [];
  // the live library hours come from the university's site: a test machine may not reach it (the app falls back)
  const ours = (url) => url.startsWith(BASE);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('requestfailed', (r) => { if (ours(r.url())) errors.push(`${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (ours(r.url()) && r.status() >= 400) errors.push(`${r.url()} ${r.status()}`); });
  // ?notrack: test visits stay out of the visit counts
  await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'notrack');
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 90_000 });
  await page.waitForTimeout(1500);
  return { page, ctx, errors };
}

// what's on screen: visible names (pins' and areas') and pins
const layout = () => {
  const vis = (e) => { const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const onScr = (r) => r.width && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  const box = (e) => e.getBoundingClientRect();
  const labels = [...document.querySelectorAll('.pin.show-label .label, .pin.selected .label, .area-label:not(.hidden)')].filter(vis).map(box).filter(onScr);
  const dots = [...document.querySelectorAll('.pin:not(.hidden) .dot, .pin:not(.hidden) .gate')].filter(vis).map(box).filter(onScr);
  const ov = (a, c, pad) => a.left < c.right - pad && c.left < a.right - pad && a.top < c.bottom - pad && c.top < a.bottom - pad;
  let labelHits = 0, labelOnDot = 0;
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (ov(labels[i], labels[j], 1)) labelHits++;
  for (const l of labels) for (const d of dots) if (ov(l, d, 4)) labelOnDot++;
  return { names: labels.length, pins: dots.length, labelHits, labelOnDot };
};

// ---------- phone ----------
{
  const { page, ctx, errors } = await open([375, 812], '/', { welcomed: false });
  check('phone: welcome shows on a first visit', await page.locator('#welcome').isVisible());
  await page.click('#welcome-go');
  check('phone: Explore closes it', await page.waitForSelector('#welcome', { state: 'hidden', timeout: 3000 }).then(() => true, () => false));
  const home = await page.evaluate(layout);
  check('phone: opening view, no names overlap', home.labelHits === 0, JSON.stringify(home));

  // search by a timetable room code
  await page.fill('#q', 'Ma101');
  await page.waitForSelector('#results:not([hidden]) button[data-i]');
  check('phone: Ma101 finds the Mandela Building', /Mandela/.test(await page.locator('#results').innerText()));
  await page.locator('#results button[data-i]').first().click();
  await page.waitForSelector('#panel:not([hidden])');
  check('phone: picking it opens its card', /Mandela/.test(await page.locator('#panel-name').innerText()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // a category
  await page.click('#chips [data-filter="food"]');
  await page.waitForTimeout(1200);
  const food = await page.evaluate(() => [...document.querySelectorAll('.pin:not(.hidden):not(.faded)')].map((e) => e.className));
  check('phone: Food shows food places', food.length > 0 && food.filter((c) => /g-food/.test(c)).length >= food.length - 1, `${food.length} pins`);
  await page.click('#chips [data-filter="all"]');
  await page.waitForTimeout(600);

  if (await page.evaluate(() => !!window.map)) {
    // close up: every name clear of every other name and pin, and no pin hopping back and forth
    const su = await page.evaluate(async () => (await (await fetch('/data/places.json')).json()).places.find((x) => x.id === 'students-union').position);
    await page.evaluate((c) => new Promise((r) => { window.map.once('moveend', r); window.map.jumpTo({ center: c, zoom: 17.2, pitch: 45, bearing: 10 }); }), su);
    await page.waitForTimeout(800);
    const near = await page.evaluate(layout);
    check('phone: close up, names shown', near.names >= 5, JSON.stringify(near));
    check('phone: close up, no name overlaps a name or a pin', near.labelHits === 0 && near.labelOnDot === 0, JSON.stringify(near));
    const steps = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.maplibregl-marker.pin:not(.hidden)')].map((e) => {
      const r = e.getBoundingClientRect();
      return [e.getAttribute('aria-label'), { t: e.style.translate, on: r.left > 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight }];
    })));
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let prev2 = null, prev = await steps(), back = 0, su_ = 0;
    for (let i = 0; i < 16; i++) {
      const d = [Math.round((rnd() - 0.5) * 130), Math.round((rnd() - 0.5) * 280)];
      await page.evaluate((d) => new Promise((r) => { window.map.once('moveend', r); window.map.panBy(d, { duration: 0 }); }), d);
      await page.waitForTimeout(120);
      const cur = await steps();
      for (const [k, v] of Object.entries(cur)) {
        const o = prev[k];
        if (!o?.on || !v.on || o.t === v.t) continue;
        if (prev2?.[k]?.t === v.t) back++;
        if (/^Students’ Union/.test(k)) su_++;
      }
      prev2 = prev; prev = cur;
    }
    check('phone: panning, no pin hops back and forth', back === 0, `${back}`);
    // (a big pan can move it once: tilt makes things far up the screen closer together)
    check("phone: panning, the Students' Union pin stays put", su_ <= 1, `${su_} steps`);
  } else console.log('skip phone pin tests (no window.map: run against the dev server)');
  check('phone: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------- a place chosen from the search before the map has loaded ----------
// (on a slow phone the search works while "Loading the campus map…" still shows: choosing a place
// then used to throw "Style is not done loading")
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('roam.welcomed', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // a slow phone (or a tab in the background): the first frames come late, and MapLibre finishes
  // loading the style only in a frame, so the search is ready a few seconds before the map is
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window), t0 = performance.now();
    window.requestAnimationFrame = (cb) => (performance.now() - t0 < 8000 ? setTimeout(() => raf(cb), 4000) : raf(cb));
  });
  await page.goto(BASE + '/?notrack', { waitUntil: 'domcontentloaded' });
  // type as soon as the search answers (before the data arrives, typing does nothing yet)
  for (let i = 0; i < 120; i++) {
    await page.fill('#q', '');
    await page.fill('#q', 'Ma101');
    if (await page.waitForSelector('#results:not([hidden]) button[data-i]', { timeout: 500 }).then(() => true, () => false)) break;
  }
  const stillLoading = await page.locator('#loading').isVisible();
  await page.locator('#results button[data-i]').first().click({ noWaitAfter: true });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 90_000 });
  await page.waitForTimeout(2500);
  const name = await page.locator('#panel-name').innerText().catch(() => '');
  check('early choice: chosen while the map was still loading', stillLoading);
  check('early choice: its card shows the Mandela Building once the map is up', name === 'Mandela Building', name);
  check('early choice: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------- walking with GPS: 30 readings along a route ----------
// (fake readings, a few metres off the route, through Playwright's geolocation; src/gps.ts does the rest)
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: 51.458225, longitude: -0.244758, accuracy: 8 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('roam.welcomed', '1'); localStorage.setItem('roam.locationAsked', '1'); } catch { /* */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + '/?notrack&place=students-union');
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 90_000 });
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => !!window.roamDebug)) {
    // a route from the Students' Union to the Library, then walk it from its start
    await page.click('#panel .dir');
    await page.waitForSelector('#from-input');
    await page.fill('#from-input', 'Library');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /min/.test(document.querySelector('#route-result')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const route = await page.evaluate(() => window.roamDebug.route()?.coordinates ?? []);
    check('gps walk: a route to walk', route.length > 3, `${route.length} points`);
    // 30 readings, one a second, 1.3 m apart along the route (walking pace), each up to 4 m off, accuracy 8 m
    const R = 111320, k = Math.cos((route[0][1] * Math.PI) / 180);
    const d = (a, b) => Math.hypot((a[0] - b[0]) * R * k, (a[1] - b[1]) * R);
    const pts = [];
    let need = 0;
    for (let i = 1; i < route.length && pts.length < 60; i++) {
      let a = route[i - 1]; const b = route[i]; let L = d(a, b);
      while (L >= need && pts.length < 60) { const t = need / L; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; pts.push(a); L -= need; need = 1.3; }
      need -= L;
    }
    let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    const walk = pts.slice(0, 30).map((p) => [p[0] + (rnd() * 8) / (R * k), p[1] + (rnd() * 8) / R]);
    await ctx.setGeolocation({ longitude: walk[0][0], latitude: walk[0][1], accuracy: 8 });
    await page.click('#findme');
    await page.waitForFunction(() => !!window.roamDebug.me(), null, { timeout: 15_000 }).catch(() => {});
    const seen = [];
    for (const p of walk) {
      await ctx.setGeolocation({ longitude: p[0], latitude: p[1], accuracy: 8 });
      await page.waitForTimeout(1000);
      seen.push(await page.evaluate(() => window.roamDebug.me()));
    }
    const shown = seen.filter(Boolean).map((m) => m.shown);
    let maxStep = 0;
    for (let i = 1; i < shown.length; i++) maxStep = Math.max(maxStep, d(shown[i - 1], shown[i]));
    check('gps walk: the character got every reading', shown.length === walk.length, `${shown.length}/${walk.length}`);
    check('gps walk: never jumps more than 15 m in one step', maxStep <= 15, `${maxStep.toFixed(1)} m`);
    const full = await page.evaluate(() => window.roamDebug.routeLine());
    const off = (p) => {
      let best = Infinity;
      for (let i = 1; i < full.length; i++) {
        const a = [(full[i - 1][0] - p[0]) * R * k, (full[i - 1][1] - p[1]) * R], b = [(full[i][0] - p[0]) * R * k, (full[i][1] - p[1]) * R];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, u = L ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L)) : 0;
        best = Math.min(best, Math.hypot(a[0] + u * dx, a[1] + u * dy));
      }
      return best;
    };
    const onLine = shown.filter((p) => off(p) < 0.5).length;
    check('gps walk: with the route shown, the character stands on its line', onLine >= shown.length * 0.9, `${onLine}/${shown.length} on the line`);
  } else console.log('skip gps walk (no window.roamDebug: run against the dev server)');
  check('gps walk: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------- a link, and directions, on a laptop ----------
{
  const { page, ctx, errors } = await open([1440, 900], '/?place=library');
  await page.waitForSelector('#panel:not([hidden])');
  check('desktop: ?place=library opens its card', /Library/i.test(await page.locator('#panel-name').innerText()));
  await page.click('#panel .dir');
  await page.waitForSelector('#from-input');
  await page.fill('#from-input', 'Froebel College');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /min/.test(document.querySelector('#route-result')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => {});
  const res = await page.locator('#route-result').innerText();
  check('desktop: directions give a walking time', /min/.test(res), res.slice(0, 60));
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => !!window.roamDebug)) {
    // the whole route on screen, beside the panel rather than under it
    const fit = await page.evaluate(() => {
      const r = window.roamDebug.route(); if (!r) return null;
      const pts = r.coordinates.map((c) => window.map.project(c));
      const panel = document.querySelector('#panel').getBoundingClientRect();
      return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)), panelRight: panel.right, W: innerWidth, H: innerHeight };
    });
    check('desktop: the route fits beside the panel', !!fit && fit.minX > fit.panelRight && fit.maxX < fit.W && fit.minY > 0 && fit.maxY < fit.H, JSON.stringify(fit));
  }
  check('desktop: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
