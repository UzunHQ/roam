// The built app in another browser engine (WebKit: what every iPhone runs): it loads, searches,
// opens cards, plans a walk, shows a bus stop's times and a shared meeting point, with no errors.
// Works whether or not the engine can draw the 3D map (without WebGL, Roam is its list view).
// Needs the built app served (`npm run build && npm run preview`) and the engine installed:
// `npx playwright-core install webkit`.
// usage: BROWSER=webkit node scripts/smoke-engine.mjs [http://localhost:4173]   (exits 1 on any failure)
import * as pw from 'playwright-core';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const NAME = process.env.BROWSER ?? 'webkit';
const engine = pw[NAME];
if (!engine) { console.error(`unknown browser "${NAME}" (chromium, webkit or firefox)`); process.exit(1); }
const browser = await engine.launch({
  ...(process.env.CHROME && NAME === 'chromium' ? { executablePath: process.env.CHROME } : {}),
  ...(NAME === 'chromium' ? { args: process.env.NO_WEBGL ? ['--disable-gpu', '--disable-3d-apis'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}),
});
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${NAME}: ${name}${detail ? ` (${detail})` : ''}`); };

const bus = (line, to, secs) => ({ lineName: line, destinationName: to, timeToStation: secs, expectedArrival: new Date(Date.now() + secs * 1000).toISOString(), modeName: 'bus' });
async function open(path) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...(NAME === 'firefox' ? {} : { isMobile: true }), hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('roam.welcomed', '1'); } catch { /* */ } });
  await ctx.route('https://api.tfl.gov.uk/**', (route) => route.fulfill({ json: [bus('265', 'Putney Bridge', 200), bus('493', 'Richmond', 20)] }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebGL|webgl/i.test(m.text())) errors.push(m.text()); });
  // ?notrack: test visits stay out of the visit counts
  await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'notrack');
  // up: the map has drawn, or (no WebGL) the list has taken its place
  await page.waitForFunction(() => document.querySelector('#loading')?.hidden || document.body.classList.contains('no-map'), null, { timeout: 90_000 }).catch(() => {});
  const mode = await page.evaluate(() => (document.body.classList.contains('no-map') ? 'list' : document.body.classList.contains('map-up') ? 'map' : 'neither'));
  return { page, ctx, errors, mode };
}

{
  const { page, ctx, errors, mode } = await open('/');
  check('the app comes up', mode !== 'neither', `as the ${mode}`);
  console.log(`     ${NAME} shows Roam as ${mode === 'map' ? 'the 3D map' : 'the list (no WebGL 2 here)'}`);
  await page.fill('#q', 'Ma101');
  await page.waitForSelector('#results:not([hidden]) button[data-i]', { timeout: 10_000 }).catch(() => {});
  check('Ma101 finds the Mandela Building', /Mandela/.test(await page.locator('#results').innerText().catch(() => '')));
  await page.locator('#results button[data-i]').first().click().catch(() => {});
  await page.waitForSelector('#panel:not([hidden])', { timeout: 10_000 }).catch(() => {});
  check('its card opens', /Mandela/.test(await page.locator('#panel-name').innerText().catch(() => '')));
  await page.click('#panel .dir').catch(() => {});
  await page.fill('#from-input', 'Main entrance').catch(() => {});
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /min/.test(document.querySelector('#route-result')?.textContent ?? ''), null, { timeout: 20_000 }).catch(() => {});
  const res = (await page.locator('#route-result').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('a walking route from the Main entrance, ending at the door', /min/.test(res) && /door/.test(res), res.slice(0, 90));
  check('no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { page, ctx, errors } = await open('/?place=bus-main-entrance-x');
  await page.waitForSelector('.bus-next li', { timeout: 20_000 }).catch(() => {});
  const rows = await page.locator('.bus-next li').allInnerTexts();
  check("a bus stop's link shows the next buses", rows.length === 2 && /^493/.test(rows[0] ?? ''), rows.join(' | ').replace(/\s+/g, ' '));
  check('bus stop: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
{
  const { page, ctx, errors } = await open('/?meet=51.45790,-0.24430');
  await page.waitForSelector('#panel:not([hidden])', { timeout: 20_000 }).catch(() => {});
  check('a shared meeting point opens its card', (await page.locator('#panel-name').innerText().catch(() => '')) === 'Meeting point', await page.locator('#panel .meta').innerText().catch(() => ''));
  check('meeting point: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// the analytics script (built app only): it is this site's own copy, and it runs
// (opened with ?notrack as everywhere here, so it sends nothing)
{
  const { page, ctx, errors } = await open('/');
  await page.waitForFunction(() => typeof window.umami?.track === 'function', null, { timeout: 10_000 }).catch(() => {});
  const a = await page.evaluate(() => ({
    scripts: [...document.scripts].map((s) => s.src).filter((src) => /umami/.test(src)),
    ready: typeof window.umami?.track === 'function',
    off: localStorage.getItem('umami.disabled'),
  }));
  check('analytics: the script comes from this site', a.scripts.length === 1 && a.scripts[0] === `${BASE}/vendor/umami.js`, a.scripts.join(', '));
  check('analytics: it runs, and a test visit is not counted', a.ready && a.off === '1', JSON.stringify(a));
  check('analytics: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failed ? `${NAME}: ${failed} failed` : `${NAME}: all passed`);
process.exit(failed ? 1 : 0);
