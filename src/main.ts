import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl, { type EaseToOptions, type Map as MLMap } from 'maplibre-gl';
import { config } from './config';
import { loadData } from './data';
import { applyTheme, bounceBuilding, clearTreesAlong, createMap, lineFeature, selectBuilding, setGeoJSON, setXray, type Theme } from './map';
import { icons, placeIcon } from './icons';
import { matchingGroups, search } from './search';
import { circle, distanceM, distanceToBounds, formatDistance, getFix, startCompass, watchFix, type Fix } from './geo';
import { avatarSvg } from './avatar';
import { Router, type Route } from './route';
import { londonNow, openState, todayText } from './hours';
import { initAnalytics, track } from './analytics';
import { FILTERS, GROUPS, PRIORITY, chipOf, filterLabel, groupLabel, groupOf, passesFilter, type Filter, type GroupId } from './categories';
import type { LngLat, Place } from './types';

// ---------- small helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};
// Animations: Full, Reduced or Off. Starts from the phone's Reduce Motion setting; About can override it.
type Motion = 'full' | 'reduced' | 'off';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionChoice = (): Motion | null => { const v = store.get('roam.motion'); return v === 'full' || v === 'reduced' || v === 'off' ? v : null; };
const motion = (): Motion => motionChoice() ?? (reducedMotion.matches ? 'reduced' : 'full');
const applyMotion = () => { document.documentElement.dataset.motion = motion(); document.dispatchEvent(new Event('roam-motion')); };
applyMotion();
reducedMotion.addEventListener('change', applyMotion);
// Theme: light for everyone by default (the daytime miniature); Dark is a saved choice in About.
const themeChoice = (): 'light' | 'dark' => (store.get('roam.theme') === 'dark' ? 'dark' : 'light');
function applyThemeChoice() {
  const t = themeChoice();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#1f2e28' : '#cfe3be');
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', t);
  document.dispatchEvent(new Event('roam-theme'));
}
applyThemeChoice();
// low-end phones skip the purely decorative motion (pond ripples, drifting route dashes)
const nav = navigator as Navigator & { deviceMemory?: number };
const lite = (nav.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency ?? 8) <= 2;
document.documentElement.classList.toggle('lite', lite);
/** animation length, or 0 (jump) unless motion is Full */
const ms = (d: number) => (motion() === 'full' ? d : 0);
const isDesktop = () => innerWidth >= 900;
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const COLLEGE: Record<string, string> = { 'digby-stuart': 'Digby Stuart', froebel: 'Froebel', southlands: 'Southlands' };
/** icon for a whole category (chips, key, "show all" suggestions) */
const groupIcon = (g: GroupId) =>
  g === 'entrance' ? icons.entrance : placeIcon(g === 'food' ? 'food' : g === 'sport' ? 'sport' : 'building', g === 'services' ? 'service' : g);

$$('[data-icon]').forEach((el) => (el.innerHTML = icons[el.dataset.icon as keyof typeof icons] ?? ''));
$$('.author').forEach((el) => (el.textContent = config.author));
// an empty link in config.ts hides its icon
$$<HTMLAnchorElement>('.ig').forEach((a) => { a.href = config.links.instagram; a.hidden = !config.links.instagram; });
$$<HTMLAnchorElement>('.li').forEach((a) => { a.href = config.links.linkedin; a.hidden = !config.links.linkedin; });
initAnalytics();

let toastTimer = 0;
function toast(msg: string, time = 4500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (time) toastTimer = window.setTimeout(() => (t.hidden = true), time);
}

// ---------- dialogs: welcome, about (focus kept inside, Esc closes) ----------
let lastFocus: HTMLElement | null = null;
function openDialog(el: HTMLElement, focus: HTMLElement) {
  lastFocus = document.activeElement as HTMLElement;
  el.hidden = false;
  focus.focus();
}
function closeDialog(el: HTMLElement) {
  el.hidden = true;
  lastFocus?.focus?.();
}
document.addEventListener('keydown', (e) => {
  const open = $$('.about').find((d) => !d.hidden);
  if (!open || e.key !== 'Tab') return;
  const f = $$('button, a[href]').filter((x) => open.contains(x));
  const [first, last] = [f[0], f[f.length - 1]];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

const linkedId = new URLSearchParams(location.search).get('place');
const welcome = $('#welcome');
// every visit opens with the welcome card (direct links to a building skip it). It steps aside
// by itself after a few seconds, unless you're reading or using it.
$('.welcome-mascot').innerHTML = avatarSvg.replace('width="48" height="63"', '');
let helloTimer = 0;
const dismissWelcome = () => {
  clearTimeout(helloTimer);
  if (welcome.hidden) return;
  document.body.classList.remove('hello-open');
  welcome.classList.add('bye');
  setTimeout(() => { welcome.hidden = true; welcome.classList.remove('bye'); }, ms(200));
};
const helloLater = () => {
  clearTimeout(helloTimer);
  helloTimer = window.setTimeout(() => (welcome.matches(':hover, :focus-within') ? helloLater() : dismissWelcome()), 9000);
};
if (!linkedId) {
  welcome.hidden = false;
  document.body.classList.add('hello-open');
  setTimeout(() => $('.welcome-mascot').classList.add('greet'), 500);
  helloLater();
}
$('#welcome-go').addEventListener('click', dismissWelcome);
$('.hello-close').addEventListener('click', dismissWelcome);
// "Find me" on the card does what the locate button does
$('#welcome-find').addEventListener('click', () => { dismissWelcome(); $('#findme').click(); });

const about = $('#about');
$('#about-btn').addEventListener('click', () => {
  $$<HTMLInputElement>('input[name=motion]').forEach((r) => (r.checked = r.value === motion()));
  $$<HTMLInputElement>('input[name=theme]').forEach((r) => (r.checked = r.value === themeChoice()));
  openDialog(about, $('.about-close'));
});
about.addEventListener('change', (e) => {
  const r = e.target as HTMLInputElement;
  if (r.name === 'theme') { store.set('roam.theme', r.value); applyThemeChoice(); }
  if (r.name !== 'motion') return;
  store.set('roam.motion', r.value);
  applyMotion();
});
$('.about-close').addEventListener('click', () => closeDialog(about));
about.addEventListener('click', (e) => { if (e.target === about) closeDialog(about); });

// ---------- start ----------
main().catch((err) => {
  console.error(err);
  const l = $('#loading');
  l.hidden = false;
  l.innerHTML = `<span>Sorry, the campus data didn't load. Check your connection and try again.</span> <button class="btn primary" id="retry">Try again</button>`;
  $('#retry').addEventListener('click', () => location.reload());
});

async function main() {
  const { doc, places, campus, paths } = await loadData();
  const byId = new Map(places.map((p) => [p.id, p]));
  const groupCount = new Map<GroupId, number>();
  for (const p of places) groupCount.set(groupOf(p), (groupCount.get(groupOf(p)) ?? 0) + 1);
  const footprints = new Map<string, LngLat[]>();
  for (const f of campus.features) {
    if (f.properties?.layer === 'building' && f.geometry.type === 'Polygon') footprints.set(f.properties.osmId, f.geometry.coordinates[0] as LngLat[]);
  }
  const router = new Router(paths);
  // Which place a building tap opens when several share one building: the building itself (named
  // like it in OpenStreetMap), not the café, prayer room or post room inside it.
  const SUB_KINDS = new Set(['faith', 'post', 'cafe', 'restaurant', 'bar', 'shop']);
  const osmName = new Map<string, string>();
  for (const f of campus.features) if (f.properties?.layer === 'building' && f.properties.name) osmName.set(f.properties.osmId, String(f.properties.name).toLowerCase());
  const footprintToPlace = new Map<string, Place>();
  {
    const score = (p: Place) => {
      const n = osmName.get(p.footprintId!) ?? '\u0000', m = p.name.toLowerCase();
      return (p.category !== 'food' && !SUB_KINDS.has(p.kind) ? 2 : 0) + (n.includes(m) || m.includes(n) ? 1 : 0);
    };
    for (const p of places) {
      if (!p.footprintId) continue;
      const had = footprintToPlace.get(p.footprintId);
      if (!had || score(p) > score(had)) footprintToPlace.set(p.footprintId, p);
    }
  }
  // a place inside someone else's building (a café, the post room) is routed to its own spot,
  // not to whichever side of the whole building is nearest
  const routeTarget = (p: Place): Place =>
    p.footprintId && footprintToPlace.get(p.footprintId) !== p ? { ...p, footprintId: null } : p;

  // ---------- map (falls back to the list if WebGL is unavailable) ----------
  const theme = (): Theme => themeChoice();
  let map: MLMap | null = null;
  try {
    map = createMap({ container: 'map', campus, bounds: doc.bounds, theme: theme() });
  } catch (err) {
    console.error(err);
  }
  const loading = $('#loading');
  if (map) {
    const slow = setTimeout(() => { loading.textContent = 'The map is taking a while. You can use the list view in the meantime.'; }, 10000);
    map.once('load', () => { clearTimeout(slow); loading.hidden = true; });
    document.addEventListener('roam-theme', () => applyTheme(map!, theme()));
    if (import.meta.env.DEV) Object.assign(window, { map, roamDebug: { route: () => lastRoute } });
  }

  const campusCenter: LngLat = (() => {
    const pts = places.filter((p) => p.category !== 'entrance').map((p) => p.position);
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  })();
  const homeZoom = () => (innerWidth < 500 ? 16.1 : 16.7);
  map?.jumpTo({ center: campusCenter, zoom: homeZoom() });
  // the overview frames every campus building (its footprint's corners), not just the pins
  const campusPoints: LngLat[] = places.filter((p) => p.category !== 'entrance').map((p) => p.position);
  for (const f of campus.features) {
    if (f.properties?.layer !== 'building' || f.properties?.campus === false || f.geometry.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as LngLat[];
    const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
    campusPoints.push([Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)], [Math.max(...xs), Math.min(...ys)]);
  }

  // ---------- state ----------
  let current: Place | null = null;
  let directionsOpen = false;
  let routeShown = false;
  let routeFrom: Place | null = null;
  let navigating = false; // after Start: the directions fold into a slim bar and the map follows you
  let lastRoute: Route | null = null;
  let routeLine: LngLat[] = []; // the whole route, start hop included (for see-through buildings)
  let filter: Filter = 'all';
  // saved places live on this phone only
  const saved = new Set<string>((() => { try { return JSON.parse(store.get('roam.saved') ?? '[]') as string[]; } catch { return []; } })().filter((id) => byId.has(id)));
  const passes = (p: Place) => (filter === 'saved' ? saved.has(p.id) : passesFilter(filter, groupOf(p)));

  // ---------- markers ----------
  type M = { p: Place; group: GroupId; marker: maplibregl.Marker; el: HTMLButtonElement; offset: [number, number]; labelW: number };
  const markers = new Map<string, M>();
  for (const p of places) {
    const group = groupOf(p);
    const el = document.createElement('button');
    el.className = `pin g-${group}`;
    el.setAttribute('aria-label', `${p.name}, ${groupLabel(group)}`);
    el.innerHTML = group === 'entrance'
      ? `<span class="gate">${icons.entrance}</span><span class="label">${esc(p.name)}</span>`
      : `<span class="dot">${placeIcon(p.category, p.kind)}</span><span class="label"><span class="lname">${esc(p.name)}</span>${p.code ? `<span class="lcode">${esc(p.code)}</span>` : ''}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); select(p, { source: 'marker' }); });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(p.position);
    if (map) marker.addTo(map);
    markers.set(p.id, { p, group, marker, el, offset: [0, 0], labelW: 0 });
  }
  // places sharing a spot (e.g. a café inside its building) sit side by side instead of stacking
  {
    const near = (a: Place, b: Place) => Math.abs(a.position[0] - b.position[0]) < 0.00018 && Math.abs(a.position[1] - b.position[1]) < 0.00011; // ~12 m
    const clusters: Place[][] = [];
    for (const p of places.filter((x) => x.category !== 'entrance')) {
      const c = clusters.find((c) => near(c[0], p));
      if (c) c.push(p); else clusters.push([p]);
    }
    for (const c of clusters) {
      if (c.length < 2) continue;
      c.forEach((p, i) => {
        const m = markers.get(p.id)!;
        m.offset = [(i - (c.length - 1) / 2) * 32, 0];
        m.marker.setOffset(m.offset);
      });
    }
  }

  // ---------- college areas: their names over the overview; tap one to zoom in ----------
  const AREA_Z = 16.65;
  const areas = (['digby-stuart', 'froebel', 'southlands'] as const).map((college) => {
    const pts = places.filter((p) => p.college === college && p.category !== 'entrance').map((p) => p.position);
    const c: LngLat = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const el = document.createElement('button');
    el.className = `area-label area-${college}`;
    el.innerHTML = `<span class="area-icon">${icons.campus}</span><span>${COLLEGE[college]}</span>`;
    el.setAttribute('aria-label', `${COLLEGE[college]} college: zoom in`);
    // straight to the college at street level (where building names take over)
    el.addEventListener('click', (e) => { e.stopPropagation(); map?.easeTo({ center: c, zoom: 16.9, pitch: tilt(50), duration: ms(600) }); });
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c);
    if (map) marker.addTo(map);
    return { el, c };
  });

  // Fewer markers when zoomed out, more detail when zoomed in. Runs on moveend only (not every
  // frame): greedy by category priority, the selected place and route start always show.
  function layoutMarkers() {
    if (!map) return;
    const z = map.getZoom();
    document.body.classList.toggle('compact-pins', z < 16.6);
    const gap = z < 16 ? 30 : z < 17 ? 26 : 22;
    const W = innerWidth, H = innerHeight;
    const dots: [number, number][] = [];
    const keyDots: [number, number][] = []; // dots that labels must avoid (faded context pins don't count)
    const labels: [number, number, number, number][] = [];
    const isSel = (m: M) => m.p.id === current?.id || m.p.id === routeFrom?.id;
    // college names take the space they need on the overview; pins underneath step aside
    const showAreas = z < AREA_Z;
    const areaBoxes: [number, number, number, number][] = [];
    for (const a of areas) {
      a.el.classList.toggle('hidden', !showAreas);
      a.el.tabIndex = showAreas ? 0 : -1;
      if (!showAreas) continue;
      const pt = map.project(a.c), w = a.el.offsetWidth / 2 + 8;
      areaBoxes.push([pt.x - w, pt.y - 24, pt.x + w, pt.y + 24]);
    }
    const off = (m: M) => m.group !== 'entrance' && !passes(m.p); // outside the chosen category
    const list = [...markers.values()].sort((a, b) => Number(isSel(b)) - Number(isSel(a)) || Number(off(a)) - Number(off(b)) || PRIORITY[b.group] - PRIORITY[a.group]);
    const shown: { m: M; x: number; y: number; sel: boolean }[] = [];
    for (const m of list) {
      const sel = isSel(m);
      const filtered = off(m);
      const tooFar = m.group === 'entrance' && z < 16.3;
      // places outside the chosen category stay as faint context once you're zoomed in; matches always come first
      let show = sel || (!tooFar && (!filtered || z >= 16.6));
      m.el.classList.toggle('faded', filtered && !sel);
      const pt = map.project(m.p.position);
      const x = pt.x + m.offset[0], y = pt.y + m.offset[1];
      const onScreen = x > -40 && x < W + 40 && y > -40 && y < H + 40;
      if (show && onScreen && !sel && dots.some(([a, b]) => Math.hypot(a - x, b - y) < gap)) show = false;
      if (show && !sel && areaBoxes.some(([a, b, c, d]) => x > a && x < c && y > b && y < d)) show = false;
      m.el.classList.toggle('hidden', !show);
      m.el.tabIndex = show ? 0 : -1;
      m.el.classList.remove('show-label');
      if (show && onScreen) { dots.push([x, y]); if (!filtered || sel) { shown.push({ m, x, y, sel }); keyDots.push([x, y]); } }
    }
    // second pass: names where they cover neither another label nor a dot. The main buildings and
    // the library get theirs from zoom 16.3, food and sport from 16.8, everything else from 17.
    const minPriority = z >= 17 ? 0 : z >= 16.8 ? 7 : z >= 16.3 ? 8 : Infinity;
    // floating buttons count as taken space, so names never hide half under them
    const taken = ['.controls', '#key-btn'].map((sel) => $(sel).getBoundingClientRect()).filter((r) => r.width)
      .map((r) => [r.left - 4, r.top - 4, r.right + 4, r.bottom + 4] as [number, number, number, number]);
    for (const { m, x, y, sel } of shown) {
      if (!sel && PRIORITY[m.group] < minPriority) continue;
      if (!m.labelW) m.labelW = m.el.querySelector<HTMLElement>('.label')!.offsetWidth || 120;
      const box: [number, number, number, number] = [x - m.labelW / 2, y + 14, x + m.labelW / 2, y + 36];
      const clipped = box[0] < 4 || box[2] > W - 4 || taken.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b);
      if (!sel && clipped) continue;
      const hitsDot = keyDots.some(([dx, dy]) => (dx !== x || dy !== y) && dx + 12 > box[0] && dx - 12 < box[2] && dy + 12 > box[1] && dy - 12 < box[3]);
      const hitsLabel = labels.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b);
      if (sel || (!hitsDot && !hitsLabel)) { labels.push(box); m.el.classList.add('show-label'); }
    }
  }
  map?.on('moveend', layoutMarkers);
  map?.once('load', layoutMarkers);
  addEventListener('resize', () => layoutMarkers());

  // ---------- ambient: slow ripples on the larger ponds (CSS only; none in Reduced/Off or on low-end phones) ----------
  if (map) {
    const [bw, bs, be, bn] = doc.bounds;
    const ponds = campus.features
      .filter((f) => f.properties?.layer === 'water' && f.geometry.type === 'Polygon')
      .map((f) => {
        const ring = (f.geometry as GeoJSON.Polygon).coordinates[0] as LngLat[];
        let a = 0, cx = 0, cy = 0;
        for (let i = 0; i < ring.length - 1; i++) {
          const [x0, y0] = ring[i], [x1, y1] = ring[i + 1], k = x0 * y1 - x1 * y0;
          a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
        }
        return { area: Math.abs(a / 2), c: [cx / (3 * a), cy / (3 * a)] as LngLat };
      })
      .filter((p) => p.c[0] > bw && p.c[0] < be && p.c[1] > bs && p.c[1] < bn)
      .sort((a, b) => b.area - a.area)
      .slice(0, 3);
    ponds.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'ripple';
      el.setAttribute('aria-hidden', 'true');
      el.style.setProperty('--d', `${i * 1.4}s`);
      el.innerHTML = '<i></i><i></i>';
      new maplibregl.Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' }).setLngLat(p.c).addTo(map!);
    });
    // ripples keep a real-world size: about 45 m across
    const rippleSize = () => document.documentElement.style.setProperty('--ripple', `${Math.round(60 * 2 ** (map!.getZoom() - 17))}px`);
    rippleSize();
    map.on('zoomend', rippleSize);
  }

  // ---------- filters ----------
  const chips = $('#chips');
  const visibleGroups = GROUPS.filter((g) => g.id !== 'entrance' && (groupCount.get(g.id) ?? 0) > 0); // never show empty categories
  const visibleFilters = FILTERS.filter((f) => f.groups.some((g) => (groupCount.get(g) ?? 0) > 0));
  chips.innerHTML = `<button class="chip" data-filter="all" aria-pressed="true">All</button>` +
    `<button class="chip saved-chip" data-filter="saved" aria-pressed="false" aria-label="Your saved places"${saved.size ? '' : ' hidden'}><span class="chip-dot">${icons.bookmark}</span>Saved</button>` +
    visibleFilters.map((f) => `<button class="chip" data-filter="${f.id}" aria-pressed="false" aria-label="${f.full}"><span class="chip-dot g-${f.icon}">${groupIcon(f.icon)}</span>${f.label}</button>`).join('');
  // a fade on the edge that has more chips behind it, so the row reads as scrollable
  const chipEdges = () => {
    const max = chips.scrollWidth - chips.clientWidth;
    chips.classList.toggle('more-right', chips.scrollLeft < max - 2);
    chips.classList.toggle('more-left', chips.scrollLeft > 2);
  };
  chips.addEventListener('scroll', chipEdges, { passive: true });
  addEventListener('resize', chipEdges);
  requestAnimationFrame(chipEdges);
  function setFilter(f: Filter) {
    filter = f;
    const chip = chipOf(f);
    $$('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === chip)));
    $(`.chip[data-filter="${chip}"]`).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: ms(1) ? 'smooth' : 'auto' });
    layoutMarkers();
    if (!$('#list').hidden) renderList();
    if (input.value) showResults();
  }
  chips.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.chip');
    // tapping the active chip again resets to All
    if (c) setFilter((c.dataset.filter === chipOf(filter) ? 'all' : c.dataset.filter) as Filter);
  });

  // ---------- map key ----------
  const key = $('#key');
  key.innerHTML = `<h3>Key</h3><ul>` +
    visibleGroups.map((g) => `<li><span class="chip-dot g-${g.id}">${groupIcon(g.id)}</span>${g.label}</li>`).join('') +
    `<li><span class="chip-dot g-entrance">${icons.entrance}</span>Campus entrance</li></ul>
    <h4>Roof and roof-edge colours: the college</h4><ul>
      <li><span class="swatch roof-digby"></span>Digby Stuart</li>
      <li><span class="swatch roof-froebel"></span>Froebel</li>
      <li><span class="swatch roof-southlands"></span>Southlands</li>
      <li><span class="swatch roof-other"></span>Other university building</li>
    </ul>
    <h4>Roof types (from aerial views)</h4><ul>
      <li><span class="swatch roof-slate"></span>Pitched slate roof</li>
      <li><span class="swatch roof-tile"></span>Pitched tile roof</li>
      <li><span class="swatch roof-green"></span>Green (planted) roof</li>
      <li><span class="swatch roof-solar"></span>Solar panels</li>
      <li><span class="swatch roof-metal"></span>Metal roof</li>
    </ul>
    <ul><li><span class="swatch line-path"></span>Footpath</li><li><span class="swatch line-road"></span>Road</li><li><span class="swatch line-route"></span>Walking route</li>
      <li><span class="swatch sel-roof"></span>Selected building</li>
      <li><span class="key-me">${avatarSvg.replace('width="48" height="63"', 'width="18" height="24"')}</span>You (after you share your location)</li></ul>`;
  const keyBtn = $('#key-btn');
  const toggleKey = (open = key.hidden) => { key.hidden = !open; keyBtn.setAttribute('aria-expanded', String(open)); };
  keyBtn.addEventListener('click', () => toggleKey());

  // ---------- map controls ----------
  $('#zoom-in').addEventListener('click', () => map?.zoomIn({ duration: ms(250) }));
  $('#zoom-out').addEventListener('click', () => map?.zoomOut({ duration: ms(250) }));
  let flat = false; // 2D: looking straight down
  const tilt = (pitch: number) => (flat ? 0 : pitch);
  $('#north').addEventListener('click', () => map?.easeTo({ bearing: 0, pitch: tilt(55), duration: ms(400) }));
  $('#whole').addEventListener('click', () => showWholeCampus());
  const dimBtn = $('#dim');
  dimBtn.addEventListener('click', () => {
    flat = !flat;
    map?.easeTo({ pitch: tilt(55), duration: ms(450) });
    dimBtn.textContent = flat ? '2D' : '3D';
    dimBtn.setAttribute('aria-pressed', String(!flat));
    dimBtn.setAttribute('aria-label', flat ? 'Switch to a 3D map' : 'Switch to a flat 2D map');
  });
  // Phones are tall and the campus runs south-west to north-east, so the phone overview faces
  // north-east (like the official campus map, turned to portrait). The compass button resets to north.
  const PHONE_BEARING = 28;
  function showWholeCampus(duration = 500) {
    if (!map) return;
    const phone = !isDesktop();
    // a little more top-down than before, so paths and entrances read clearly
    fitPoints(campusPoints, { pitch: tilt(phone ? 38 : 45), bearing: phone ? PHONE_BEARING : 0, maxZoom: 17, fullWidth: phone, duration });
  }
  if (!linkedId) map?.once('load', () => showWholeCampus(0));
  const northIcon = $('#north svg');
  map?.on('rotate', () => { northIcon.style.transform = `rotate(${-map!.getBearing()}deg)`; drawHeading(); });

  // ---------- location: only after the person says yes, then live while the app is on screen ----------
  let fix: Fix | null = null;
  let compassHeading: number | null = null;
  let stopCompass: (() => void) | null = null;
  const avatarEl = document.createElement('div');
  avatarEl.className = 'avatar';
  avatarEl.setAttribute('aria-hidden', 'true');
  avatarEl.innerHTML = `<div class="arrow" hidden></div><div class="halo"></div>${avatarSvg}`;
  // feet on the spot: the SVG's ground line is 2 px above its bottom edge
  const avatar = new maplibregl.Marker({ element: avatarEl, anchor: 'bottom', offset: [0, 2] });

  function drawHeading() {
    const arrow = avatarEl.querySelector<HTMLElement>('.arrow')!;
    const h = compassHeading ?? fix?.heading ?? null;
    arrow.hidden = h == null; // no compass, or permission refused: no arrow
    if (h != null && map) arrow.style.transform = `rotate(${h - map.getBearing()}deg)`;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopCompass?.(); stopCompass = null; compassHeading = null; drawHeading(); }
    // GPS only runs while Roam is on screen
    if (document.hidden) { stopWatch?.(); stopWatch = null; } else if (tracking) startTracking();
  });

  let tracking = false;
  let stopWatch: (() => void) | null = null;
  let trail: Fix[] = []; // the last few seconds of fixes
  let shownPos: LngLat | null = null;
  let glide = 0;
  let walkTimer = 0;
  let following = false; // camera keeps you in view
  let camBusyUntil = 0; // a bigger camera move is under way; following waits for it instead of cutting it short
  const camMove = (opts: EaseToOptions) => { camBusyUntil = Date.now() + (opts.duration ?? 0) + 80; map?.easeTo(opts); };
  let stale = false;
  let lastFixAt = 0;
  let greeted = false;
  let routeEnd: LngLat | null = null;
  let arrivalArmed = false;
  const findBtn = $('#findme');
  // until we have a real fix, the button says what it does (no character at a made-up spot)
  findBtn.insertAdjacentHTML('beforeend', '<span class="find-label" aria-hidden="true">Find me</span>');

  function setFollowing(on: boolean) {
    following = on;
    findBtn.classList.toggle('following', on);
    findBtn.setAttribute('aria-pressed', String(on));
    findBtn.setAttribute('aria-label', on ? 'Following your location. Move the map to stop.' : 'Show my location');
  }
  // moving the map by hand pauses following; the locate button brings it back
  map?.on('dragstart', () => { if (following) setFollowing(false); });

  /** a speech bubble over the character */
  function say(text: string, time = 3300) {
    avatarEl.querySelector('.say')?.remove();
    const b = document.createElement('div');
    b.className = 'say';
    b.textContent = text;
    avatarEl.appendChild(b);
    setTimeout(() => b.remove(), time);
  }
  function play(cls: 'greet' | 'cheer', time: number) {
    avatarEl.classList.add(cls);
    setTimeout(() => avatarEl.classList.remove(cls), time);
  }
  function markFresh() {
    lastFixAt = Date.now();
    if (stale) { stale = false; avatarEl.classList.remove('stale'); }
  }
  // no new reading for a while (indoors, or the phone paused GPS): fade the character instead of pretending
  setInterval(() => {
    if (!tracking || !lastFixAt || document.hidden) return;
    const old = Date.now() - lastFixAt > 30000;
    if (old !== stale) { stale = old; avatarEl.classList.toggle('stale', old); }
  }, 5000);

  function startTracking() {
    tracking = true;
    if (stopWatch || document.hidden || !('geolocation' in navigator)) return;
    lastFixAt = Date.now(); // the clock for "stale" starts when GPS (re)starts
    stopWatch = watchFix(onLiveFix, (err) => { if (err.code === 1) { tracking = false; stopWatch?.(); stopWatch = null; } });
  }

  function onLiveFix(f: Fix) {
    if (!map || !shownPos) return; // the first fix goes through showFix
    fix = f;
    markFresh();
    setGeoJSON(map, 'user', { type: 'Feature', properties: {}, geometry: circle(f.pos, f.accuracy) });
    trail = [...trail, f].filter((t) => f.time - t.time <= 6000);
    const first = trail[0];
    // GPS wanders a few metres even when you stand still, so only count a clear move over the last few seconds
    const clearMove = distanceM(first.pos, f.pos) > Math.max(4, Math.min(f.accuracy * 0.6, 15));
    const moving = f.speed != null ? f.speed > 0.6 : clearMove;
    if (f.heading != null) faceLeft(Math.sin(((f.heading - map.getBearing()) * Math.PI) / 180) < 0);
    else if (clearMove) {
      const a = map.project(first.pos), b = map.project(f.pos);
      if (Math.abs(b.x - a.x) > 2) faceLeft(b.x < a.x);
    }
    if (moving) {
      avatarEl.classList.add('walking');
      clearTimeout(walkTimer);
      walkTimer = window.setTimeout(() => avatarEl.classList.remove('walking'), 2500);
    }
    glideTo(f.pos);
    drawHeading();
    if (following && Date.now() > camBusyUntil) map.easeTo({ center: f.pos, duration: ms(700) });
    if (navigating) onNavFix(f);
    // arrival: only from a decent fix, close to the end of the route you were shown
    if (routeShown && routeEnd && arrivalArmed && f.accuracy <= 30 && distanceM(f.pos, routeEnd) <= Math.max(12, f.accuracy)) {
      arrivalArmed = false;
      play('cheer', 1400);
      say('You made it!');
      toast(`You've arrived${current ? ` at ${current.name}` : ''}.`, 5000);
      if (navigating) {
        const left = document.querySelector('#nav-left');
        if (left) { left.textContent = "You've arrived"; left.classList.add('arrived'); }
        setTimeout(() => { if (navigating) endNavigation(); }, 4000);
      }
    }
  }

  const faceLeft = (left: boolean) => avatarEl.classList.toggle('face-left', left);

  /** Slide the character to the new fix instead of jumping. */
  function glideTo(to: LngLat) {
    cancelAnimationFrame(glide);
    const from = shownPos;
    if (!from || motion() !== 'full' || distanceM(from, to) > 60) { shownPos = to; avatar.setLngLat(to); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min((now - t0) / 900, 1), e = k * (2 - k);
      shownPos = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
      avatar.setLngLat(shownPos);
      if (k < 1) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }

  let pendingLocate: ((ok: boolean) => void) | null = null;
  /** Ask with a one-line reason the first time; resolves true once we have a fix. */
  function requestLocation(): Promise<boolean> {
    if (!('geolocation' in navigator)) { toast('This browser cannot share your location. You can choose a starting point instead.'); return Promise.resolve(false); }
    return new Promise((resolve) => {
      pendingLocate = resolve;
      if (store.get('roam.locationAsked')) locate();
      else { $('#ask').hidden = false; $('[data-ask=yes]').focus(); }
    });
  }
  $('#ask').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ask]');
    if (!b) return;
    $('#ask').hidden = true;
    if (b.dataset.ask === 'yes') { store.set('roam.locationAsked', '1'); locate(); }
    else { pendingLocate?.(false); pendingLocate = null; }
  });

  async function locate() {
    // compass permission has to be requested inside the tap (iOS)
    if (!stopCompass) startCompass((h) => { compassHeading = h; drawHeading(); }).then((stop) => { stopCompass = stop; if (!stop) { compassHeading = null; drawHeading(); } });
    const btn = $('#findme');
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('busy');
    try {
      fix = await getFix();
      showFix(fix);
      startTracking();
      pendingLocate?.(true);
    } catch (err) {
      toast((err as GeolocationPositionError).code === 1
        ? 'Location access was refused. You can still choose a starting point by hand.'
        : "We couldn't get your location. Try again outdoors, or choose a starting point.", 6000);
      pendingLocate?.(false);
    } finally {
      pendingLocate = null;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('busy');
    }
  }

  function showFix(f: Fix) {
    if (!map) return;
    cancelAnimationFrame(glide);
    shownPos = f.pos;
    trail = [f];
    avatar.setLngLat(f.pos).addTo(map);
    markFresh();
    setGeoJSON(map, 'user', { type: 'Feature', properties: {}, geometry: circle(f.pos, f.accuracy) });
    drawHeading();
    findBtn.classList.add('active');
    document.body.classList.add('has-fix');
    const off = distanceToBounds(f.pos, doc.bounds);
    if (off > 0) { setFollowing(false); toast(`You're not on campus yet · ${formatDistance(off)} away`, 6000); return; }
    if (f.accuracy > config.weakGpsM) toast(`GPS is weak here · accurate to about ${Math.round(f.accuracy)} m`, 5000);
    if (!routeShown) {
      setFollowing(true);
      camMove({ center: f.pos, zoom: Math.max(map.getZoom(), 17.2), duration: ms(500) });
    }
    if (!greeted) {
      greeted = true;
      setTimeout(() => { say("Hi! You're here."); play('greet', 2600); }, ms(450));
    }
  }
  findBtn.addEventListener('click', async () => {
    if (map && tracking && fix && !stale) {
      // already live: bring the map back to you and keep following
      const off = distanceToBounds(fix.pos, doc.bounds);
      if (off > 0) { toast(`You're not on campus yet · ${formatDistance(off)} away`, 6000); return; }
      setFollowing(true);
      camMove({ center: fix.pos, zoom: Math.max(map.getZoom(), 17.2), duration: ms(500) });
      return;
    }
    if (stale) toast("Your location hasn't updated for a while. Checking again…", 4000);
    if ((await requestLocation()) && current && directionsOpen && fromValue === 'me') planRoute();
  });

  // ---------- panel (bottom sheet on phones, side panel on large screens) ----------
  const panel = $('#panel');
  const panelBody = $('#panel-body');
  let panelOpener: HTMLElement | null = null;

  function openPanel() {
    if (panel.hidden) {
      panelOpener = document.activeElement as HTMLElement;
      panel.hidden = false;
      void panel.offsetHeight; // start the transition from the closed position
    }
    panel.classList.add('open');
    document.body.classList.add('panel-open');
  }
  function closePanel() {
    leaveNavMode();
    current = null;
    directionsOpen = false;
    clearRoute();
    panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, ms(180));
    $$('.pin.selected').forEach((el) => el.classList.remove('selected'));
    if (map) selectBuilding(map, null);
    showDoor(null);
    history.replaceState(null, '', location.pathname);
    layoutMarkers();
    if (panelOpener && document.contains(panelOpener)) panelOpener.focus();
  }

  /** the part of the map not covered by the header, controls or panel */
  function freeArea() {
    const top = $('.top').getBoundingClientRect().bottom + 12;
    const mapH = $('#map').clientHeight;
    let bottom = mapH - 12, left = 12;
    if (!panel.hidden) {
      // layout position, not getBoundingClientRect: ignores the slide-in transform
      if (isDesktop()) left = panel.offsetLeft + panel.offsetWidth + 12;
      else bottom = Math.min(bottom, panel.offsetTop - 12);
    }
    const right = innerWidth - 68;
    return { top, bottom: Math.max(top + 60, bottom), left, right, mapH };
  }
  /**
   * Fit points into the free part of the screen. Projects them at the target tilt, so tilted 3D
   * views fit too (fitBounds ignores the tilt, which pushed routes behind the panel on phones).
   */
  function fitPoints(points: LngLat[], opts: { pitch?: number; bearing?: number; maxZoom?: number; fullWidth?: boolean; duration?: number } = {}) {
    if (!map || !points.length) return;
    const W = map.getCanvas().clientWidth, H = map.getCanvas().clientHeight;
    const a = freeArea();
    // pins stand about 20 px either side of their point and 40 px above it
    // full width (phone overview): keep clear of the Key button and the control column's lower half
    const box = opts.fullWidth
      ? { l: 22, r: W - 22, t: a.top + 24, b: Math.min(a.bottom, H) - 60 }
      : { l: a.left + 20, r: Math.min(a.right, W) - 20, t: a.top + 30, b: Math.min(a.bottom, H) - 8 };
    const zero = { top: 0, bottom: 0, left: 0, right: 0 };
    const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding() };
    const b = new maplibregl.LngLatBounds(points[0], points[0]);
    for (const p of points) b.extend(p);
    map.jumpTo({ center: b.getCenter(), zoom: opts.maxZoom ?? 18, pitch: opts.pitch ?? map.getPitch(), bearing: opts.bearing ?? map.getBearing(), padding: zero });
    for (let i = 0; i < 40; i++) {
      const xy = points.map((p) => map!.project(p));
      const xs = xy.map((q) => q.x), ys = xy.map((q) => q.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const dx = (minX + maxX) / 2 - (box.l + box.r) / 2, dy = (minY + maxY) / 2 - (box.t + box.b) / 2;
      map.jumpTo({ center: map.unproject([W / 2 + dx, H / 2 + dy]) });
      const fits = maxX - minX <= box.r - box.l && maxY - minY <= box.b - box.t;
      const centred = Math.abs(dx) < 2 && Math.abs(dy) < 2;
      if (fits && centred) break;
      if (!fits && map.getZoom() > map.getMinZoom()) map.jumpTo({ zoom: Math.max(map.getMinZoom(), map.getZoom() - 0.15) });
      else if (centred) break;
    }
    const after = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    map.jumpTo(before);
    map.easeTo({ ...after, padding: zero, duration: ms(opts.duration ?? 600) });
  }
  const pad = (top: number, bottom: number, left: number, right: number) => {
    const c = (v: number) => Math.max(0, Math.round(v));
    return { top: c(top), bottom: c(bottom), left: c(left), right: c(right) };
  };
  /** Move the camera only if the place would be hidden behind the UI (or we're far zoomed out). */
  function ensureVisible(p: Place, zoomIn: boolean) {
    if (!map) return;
    const a = freeArea();
    const pt = map.project(p.position);
    const zoom = zoomIn && map.getZoom() < 16.8 ? 17 : map.getZoom();
    const inside = pt.x > a.left && pt.x < a.right && pt.y > a.top && pt.y < a.bottom;
    if (inside && zoom === map.getZoom()) return;
    map.easeTo({
      center: p.position, zoom,
      padding: pad(a.top, a.mapH - a.bottom, a.left, innerWidth - a.right),
      duration: ms(450),
    });
  }

  function hoursBlock(p: Place): string {
    if (!p.hours) return '';
    const s = openState(p.hours, londonNow());
    const [cls, text] =
      s.kind === 'open' ? ['open', s.until === '24:00' ? 'Open 24 hours' : `Open now · until ${s.until}`]
      : s.kind === 'opens-later' ? ['closed', `Closed · opens ${s.at}`]
      : s.kind === 'closed-today' ? ['closed', 'Closed today']
      : ['unknown', "Today's hours not published"];
    const today = text === 'Open 24 hours' ? '' : `<span class="today">${todayText(p.hours)}</span>`;
    return `<div class="hours"><span class="badge ${cls}">${text}</span>${today}</div>
      ${p.hours.notes ? `<p class="notes">${esc(p.hours.notes)}</p>` : ''}`;
  }
  // places where people would expect opening hours; for these we say plainly when we don't have them
  const expectsHours = (p: Place) => ['food', 'sport', 'library', 'services'].includes(groupOf(p));

  /** "About 4 min walk from you", only from a fresh, decent fix on campus and a real path route. */
  function walkHint(p: Place): string {
    if (!fix || stale || fix.accuracy > config.weakGpsM || distanceToBounds(fix.pos, doc.bounds) > 0) return '';
    const r = router.route(fix.pos, routeTarget(p), footprints);
    return r ? `About ${r.minutes} min walk from you` : '';
  }

  function renderCard(p: Place, expanded = false) {
    const g = groupOf(p);
    const placeLabel = p.code ? `${p.name} (${p.code})` : p.name;
    const report = config.reportForm.url
      ? `${config.reportForm.url}?usp=pp_url&${config.reportForm.placeField}=${encodeURIComponent(placeLabel)}`
      : config.reportEmail
        ? `mailto:${config.reportEmail}?subject=${encodeURIComponent(`Roam mistake: ${placeLabel}`)}&body=${encodeURIComponent(`What's wrong?\n\n\n(place id: ${p.id})`)}`
        : '';
    const src = p.sources?.[0];
    const checked = src?.checked ?? p.lastVerified;
    const walk = walkHint(p);
    // compact first: name, what it is, one line of description, the way there. Everything else under "View details".
    panelBody.innerHTML = `
      <div class="p-head">
        <span class="cat-icon g-${g}">${placeIcon(p.category, p.kind)}</span>
        <div class="titles">
          <h2 id="panel-name" tabindex="-1">${esc(p.name)}</h2>
          <p class="meta">${[p.code && `<span class="code">${esc(p.code)}</span>`, esc(groupLabel(g)), p.college && COLLEGE[p.college]].filter(Boolean).join(' · ')}</p>
        </div>
        <button class="icon-btn save" aria-pressed="${saved.has(p.id)}" aria-label="Save ${esc(p.name)}">${icons.bookmark}</button>
        <button class="icon-btn close" aria-label="Close">${icons.close}</button>
      </div>
      ${p.description ? `<p class="desc${expanded ? '' : ' clamp'}">${esc(p.description)}</p>` : ''}
      ${hoursBlock(p)}
      ${walk ? `<p class="walk-hint">${icons.walk}<span>${walk}</span></p>` : ''}
      <div class="actions">
        <button class="btn primary dir">${icons.directions}<span>Take me there</span></button>
        <button class="btn ghost more-info" aria-expanded="${expanded}" aria-controls="details">${expanded ? 'Hide details' : 'View details'}</button>
      </div>
      <div id="details" class="details"${expanded ? '' : ' hidden'}>
        ${p.photo ? `<img class="photo" src="/${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="1200" height="675">` : ''}
        ${p.services?.length ? `<ul class="services" aria-label="Services">${p.services.map((s, i) => `<li${i >= 4 ? ' hidden' : ''}>${esc(s)}</li>`).join('')}${p.services.length > 4 ? `<li><button class="more" aria-label="Show ${p.services.length - 4} more services">+${p.services.length - 4} more</button></li>` : ''}</ul>` : ''}
        ${!p.hours && expectsHours(p) ? `<p class="detail-row">${icons.clock}<span>Opening hours aren't listed here yet. Check the official page.</span></p>` : ''}
        ${p.accessibility ? `<p class="access"><a href="${esc(p.accessibility.url)}" target="_blank" rel="noopener">${icons.accessible}<span>${esc(p.accessibility.summary)}</span></a></p>` : ''}
        <div class="detail-links">
          <button class="btn ghost share" aria-label="Share a link to ${esc(p.name)}">${icons.share}<span>Share</span></button>
          ${p.officialUrl ? `<a class="official" href="${esc(p.officialUrl)}" target="_blank" rel="noopener">Official page ${icons.external}</a>` : ''}
        </div>
        <p class="small">${[
          src ? `Source: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>${checked ? `, checked ${fmtDate(checked)}` : ''}` : checked ? `Last checked ${fmtDate(checked)}` : '',
          report ? `<a href="${esc(report)}"${report.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>Report a mistake</a>` : '', // hidden until a form or inbox is set in config.ts
        ].filter(Boolean).join(' · ')}</p>
      </div>`;
    panelBody.classList.remove('panel-body-in');
    void panelBody.offsetWidth;
    panelBody.classList.add('panel-body-in');
    setExpanded(expanded);
    panelBody.querySelector('.close')!.addEventListener('click', closePanel);
    panelBody.querySelector('.save')!.addEventListener('click', (e) => toggleSaved(p, e.currentTarget as HTMLElement));
    panelBody.querySelector('.dir')!.addEventListener('click', () => openDirections(p));
    panelBody.querySelector('.more-info')!.addEventListener('click', () => setExpanded(!panel.classList.contains('expanded')));
    panelBody.querySelector('.share')!.addEventListener('click', () => share(p));
    panelBody.querySelector('.more')?.addEventListener('click', (e) => {
      panelBody.querySelectorAll<HTMLElement>('.services li[hidden]').forEach((li) => (li.hidden = false));
      (e.target as HTMLElement).closest('li')!.remove();
    });
    // a missing photo simply disappears
    panelBody.querySelector<HTMLImageElement>('.photo')?.addEventListener('error', (e) => (e.target as HTMLElement).remove());
  }

  function toggleSaved(p: Place, btn: HTMLElement) {
    const on = !saved.has(p.id);
    if (on) saved.add(p.id); else saved.delete(p.id);
    store.set('roam.saved', JSON.stringify([...saved]));
    btn.setAttribute('aria-pressed', String(on));
    $('.saved-chip').hidden = !saved.size;
    if (!saved.size && filter === 'saved') setFilter('all');
    requestAnimationFrame(chipEdges);
    toast(on ? `Saved ${p.name}. Find it under Saved.` : `Removed ${p.name} from Saved.`, 3000);
  }

  /** Bottom sheet: compact by default, taller with details. The handle and "View details" both toggle it. */
  function setExpanded(on: boolean) {
    panel.classList.toggle('expanded', on);
    handle.setAttribute('aria-expanded', String(on));
    handle.setAttribute('aria-label', on ? 'Show less' : 'Show more');
    const details = panelBody.querySelector<HTMLElement>('#details');
    const btn = panelBody.querySelector<HTMLElement>('.more-info');
    if (details) details.hidden = !on;
    if (btn) { btn.setAttribute('aria-expanded', String(on)); btn.textContent = on ? 'Hide details' : 'View details'; }
    panelBody.querySelector('.desc')?.classList.toggle('clamp', !on);
    if (!on) panel.scrollTop = 0;
  }
  const handle = $('.handle');
  handle.addEventListener('click', () => {
    if (panelBody.querySelector('#details')) setExpanded(!panel.classList.contains('expanded'));
  });
  // swipe the sheet: up shows more, down shows less (or closes)
  {
    let y0 = 0, dy = 0, dragging = false;
    const head = (t: EventTarget | null) => (t as HTMLElement).closest('.handle, .p-head') && !(t as HTMLElement).closest('button:not(.handle)');
    panel.addEventListener('touchstart', (e) => {
      if (isDesktop() || !head(e.target)) return;
      dragging = true; y0 = e.touches[0].clientY; dy = 0;
      panel.classList.add('dragging');
    }, { passive: true });
    panel.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    panel.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('dragging');
      panel.style.transform = '';
      const hasDetails = !!panelBody.querySelector('#details');
      if (dy < -40 && hasDetails) setExpanded(true);
      else if (dy > 70) { if (panel.classList.contains('expanded')) setExpanded(false); else closePanel(); }
    });
  }
  // the desktop side card and list start just under the search + chips block, whatever its height
  // (measured at the chips; while search suggestions hide them the last value stays)
  new ResizeObserver(() => {
    const r = $('#chips').getBoundingClientRect();
    if (r.height) document.documentElement.style.setProperty('--top-b', `${Math.round(r.bottom)}px`);
  }).observe($('#chips'));
  // keep the floating controls above the sheet on phones
  new ResizeObserver(() => {
    const h = panel.hidden ? 0 : panel.offsetHeight;
    document.documentElement.style.setProperty('--sheet-h', `${h}px`);
    document.body.classList.toggle('sheet-tall', h > innerHeight * 0.55);
    setTimeout(layoutMarkers, 220); // after the controls have slid
  }).observe(panel);

  // the selected place's door, when its entrance has been mapped
  const doorEl = document.createElement('div');
  doorEl.className = 'door-pin';
  doorEl.setAttribute('aria-hidden', 'true');
  doorEl.innerHTML = icons.entrance;
  const doorMarker = new maplibregl.Marker({ element: doorEl, anchor: 'bottom' });
  const showDoor = (p: Place | null) => { if (map && p?.entrance) doorMarker.setLngLat(p.entrance).addTo(map); else doorMarker.remove(); };

  function select(p: Place, opts: { source: 'marker' | 'building' | 'search' | 'link' | 'list' }) {
    if (!welcome.hidden) dismissWelcome();
    if (navigating) { leaveNavMode(); clearRoute(); }
    if (current?.id !== p.id) clearRoute();
    current = p;
    directionsOpen = false;
    renderCard(p);
    openPanel();
    $$('.pin.selected').forEach((el) => el.classList.remove('selected'));
    markers.get(p.id)?.el.classList.add('selected');
    showDoor(p);
    if (map) {
      selectBuilding(map, p.footprintId);
      if (p.footprintId && ms(1)) bounceBuilding(map, p.footprintId);
    }
    history.replaceState(null, '', `?place=${encodeURIComponent(p.id)}`);
    track('place-tap', { id: p.id, via: opts.source });
    const far = opts.source !== 'marker' && opts.source !== 'building';
    requestAnimationFrame(() => { ensureVisible(p, far); layoutMarkers(); });
    if (far) $('#panel-name').focus({ preventScroll: true });
  }

  async function share(p: Place) {
    const url = `${location.origin}/?place=${encodeURIComponent(p.id)}`;
    if (navigator.share) {
      try { await navigator.share({ title: `${p.name} · Roam`, text: `${p.name} on the Roehampton campus map`, url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast(`Copy this link: ${url}`, 10000);
    }
  }

  // ---------- directions: along mapped paths only ----------
  const pinEl = (cls: string, text: string) => {
    const el = document.createElement('div');
    el.className = `route-pin ${cls}`;
    el.setAttribute('aria-hidden', 'true');
    el.textContent = text;
    return el;
  };
  const startMarker = new maplibregl.Marker({ element: pinEl('start', 'A') });
  const endMarker = new maplibregl.Marker({ element: pinEl('end', 'B') });
  let fromValue = '';

  function openDirections(p: Place) {
    directionsOpen = true;
    setExpanded(false); // keep the map visible above the directions
    const gates = places.filter((x) => x.category === 'entrance');
    const others = places.filter((x) => x.category !== 'entrance' && x.id !== p.id).sort((a, b) => a.name.localeCompare(b.name));
    if (fromValue === p.id) fromValue = '';
    if (!fromValue && fix && distanceToBounds(fix.pos, doc.bounds) === 0) fromValue = 'me';
    panelBody.innerHTML = `
      <div class="p-head">
        <button class="icon-btn back" aria-label="Back to ${esc(p.name)}">${icons.back}</button>
        <div class="titles"><h2 id="panel-name" tabindex="-1">Directions</h2><p class="meta">to ${esc(p.name)}</p></div>
        <button class="icon-btn close" aria-label="Close">${icons.close}</button>
      </div>
      <label class="field"><span>Starting from</span>
        <select id="from">
          <option value="">Choose a starting point…</option>
          <optgroup label="Your position"><option value="me">My location</option></optgroup>
          <optgroup label="Campus entrances">${gates.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</optgroup>
          <optgroup label="Places">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</optgroup>
        </select>
      </label>
      <div id="route-result" class="route-result" aria-live="polite"></div>`;
    const sel = panelBody.querySelector<HTMLSelectElement>('#from')!;
    sel.value = fromValue;
    sel.addEventListener('change', () => { fromValue = sel.value; planRoute(); });
    panelBody.querySelector('.back')!.addEventListener('click', () => { clearRoute(); directionsOpen = false; renderCard(p); $('#panel-name').focus(); layoutMarkers(); });
    panelBody.querySelector('.close')!.addEventListener('click', closePanel);
    $('#panel-name').focus({ preventScroll: true });
    planRoute();
  }

  async function planRoute() {
    const to = current;
    const out = document.querySelector<HTMLElement>('#route-result');
    if (!to || !out) return;
    clearRoute();
    if (!fromValue) {
      out.innerHTML = `<p>Choose where you're starting from, or use your location.</p>
        <button class="btn ghost use-me">${icons.locate}<span>Use my location</span></button>`;
      out.querySelector('.use-me')!.addEventListener('click', async () => {
        if (await requestLocation()) { fromValue = 'me'; panelBody.querySelector<HTMLSelectElement>('#from')!.value = 'me'; planRoute(); }
      });
      return;
    }
    let from: LngLat | Place;
    if (fromValue === 'me') {
      if (!fix && !(await requestLocation())) { out.innerHTML = '<p>Choose a starting point from the list instead.</p>'; return; }
      const f = fix!;
      const off = distanceToBounds(f.pos, doc.bounds);
      if (off > 0) {
        out.innerHTML = `<p>You're not on campus yet (${formatDistance(off)} away). Routes start on campus, so choose a campus entrance as your starting point.</p>`;
        return;
      }
      from = f.pos;
    } else {
      const p = byId.get(fromValue);
      if (!p) return;
      routeFrom = p;
      from = p;
    }
    const r = router.route(Array.isArray(from) ? from : routeTarget(from), routeTarget(to), footprints);
    if (!r) {
      out.innerHTML = `<p>We couldn't find a mapped walking route between these places. The building is highlighted on the map.</p>`;
      return;
    }
    drawRoute(r, from);
    const notes = [
      r.toEntrance ? 'Ends at the entrance.' : "Ends on the path nearest the building: its entrance hasn't been mapped yet.",
      r.hasSteps ? 'Includes steps.' : '',
      fromValue === 'me' && fix && fix.accuracy > config.weakGpsM ? `Your location is approximate (about ${Math.round(fix.accuracy)} m).` : '',
    ].filter(Boolean);
    out.innerHTML = `<p class="route-sum">${icons.walk}<span><b>About ${r.minutes} min</b> · ${formatDistance(r.distanceM)} along paths</span></p>
      <div class="route-go"><button class="btn primary start">${icons.directions}<span>Start</span></button></div>
      <ul class="route-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      <p class="small">Follows footpaths and campus roads mapped on OpenStreetMap. Step-free routes aren't available yet.</p>`;
    out.querySelector('.start')!.addEventListener('click', startNavigation);
  }

  // ---------- route motion: the line draws itself in, then light dashes drift towards the destination ----------
  let drawAnim = 0;
  let flowTimer = 0;
  const DASHES = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
    [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  function startFlow() {
    stopFlow();
    if (!map || !routeShown || motion() !== 'full' || lite) return;
    map.setPaintProperty('route-flow', 'line-opacity', 0.85);
    let i = 0;
    flowTimer = window.setInterval(() => {
      if (document.hidden || !map) return; // no work while Roam is in the background
      i = (i + 1) % DASHES.length;
      map.setPaintProperty('route-flow', 'line-dasharray', DASHES[i]);
    }, 90);
  }
  function stopFlow() {
    clearInterval(flowTimer);
    if (map?.getLayer('route-flow')) map.setPaintProperty('route-flow', 'line-opacity', 0);
  }
  document.addEventListener('roam-motion', () => (routeShown ? startFlow() : stopFlow()));
  function animateRouteIn(coords: LngLat[]) {
    cancelAnimationFrame(drawAnim);
    if (!map) return;
    if (!ms(1) || coords.length < 2) { setGeoJSON(map, 'route', lineFeature(coords)); startFlow(); return; }
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distanceM(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1] || 1;
    const t0 = performance.now(), D = Math.min(1100, 400 + total);
    const step = (now: number) => {
      if (!map) return;
      const k = Math.min((now - t0) / D, 1), d = total * (1 - (1 - k) ** 3);
      let j = cum.findIndex((c) => c >= d);
      if (j < 1) j = 1;
      const a = coords[j - 1], b = coords[j], u = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
      setGeoJSON(map, 'route', lineFeature(k < 1 ? [...coords.slice(0, j), [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]] : coords));
      if (k < 1) drawAnim = requestAnimationFrame(step);
      else startFlow();
    };
    drawAnim = requestAnimationFrame(step);
  }

  /** Show a route. `quiet` (a new route while you walk) skips the draw-in and keeps the camera on you. */
  function drawRoute(r: Route, from: LngLat | Place, quiet = false) {
    if (!map) return;
    routeShown = true;
    lastRoute = r;
    routeLine = [...r.startHop, ...r.coordinates];
    routeEnd = r.coordinates[r.coordinates.length - 1];
    if (!quiet) {
      setFollowing(false); // show the whole route first; Start (or the locate button) follows you again
      arrivalArmed = !fix || distanceM(fix.pos, routeEnd) > 25;
      animateRouteIn(r.coordinates);
    } else {
      cancelAnimationFrame(drawAnim);
      setGeoJSON(map, 'route', lineFeature(r.coordinates));
    }
    setGeoJSON(map, 'hop', lineFeature(r.startHop));
    clearTreesAlong(map, routeLine);
    // from your own position the character already marks the start
    if (Array.isArray(from)) startMarker.remove(); else startMarker.setLngLat(from.position).addTo(map);
    endMarker.setLngLat(routeEnd).addTo(map);
    xrayKey = '';
    if (quiet) { scheduleXray(); return; }
    const all = [...r.coordinates, ...r.startHop, Array.isArray(from) ? from : from.position];
    // a lower tilt for the overview, so the far end of a long route stays readable
    requestAnimationFrame(() => fitPoints(all, { pitch: tilt(40), maxZoom: 18 }));
  }
  function clearRoute() {
    routeShown = false;
    routeFrom = null;
    routeEnd = null;
    arrivalArmed = false;
    lastRoute = null;
    routeLine = [];
    cancelAnimationFrame(drawAnim);
    stopFlow();
    startMarker.remove();
    endMarker.remove();
    if (!map) return;
    setGeoJSON(map, 'route', { type: 'FeatureCollection', features: [] });
    setGeoJSON(map, 'hop', { type: 'FeatureCollection', features: [] });
    clearTreesAlong(map, null);
    setXray(map, []);
    xrayKey = '';
  }

  // ---------- see-through buildings: whatever stands between the camera and the route turns glassy ----------
  // Each route point is checked on screen: a building drawn over it (and not the one the route
  // touches) is in the way. Runs after the camera stops, never per frame.
  const XRAY_LAYERS = ['building-walls', 'building-roof', 'building-top', 'roof-solar', 'building-ghost'];
  let xrayKey = '';
  let xrayTimer = 0;
  // waits for the view's tiles (a new zoom level loads first), up to about 3 s
  const scheduleXray = (tries = 0) => {
    clearTimeout(xrayTimer);
    xrayTimer = window.setTimeout(() => (map && !map.areTilesLoaded() && tries < 20 ? scheduleXray(tries + 1) : updateXray()), tries ? 150 : 80);
  };
  /** within `m` metres of a building outline, or inside it */
  function touches(p: LngLat, ring: LngLat[], m: number) {
    const k = 111320, cos = Math.cos((p[1] * Math.PI) / 180);
    const xy = (q: LngLat) => [(q[0] - p[0]) * k * cos, (q[1] - p[1]) * k];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = xy(ring[i]), [bx, by] = xy(ring[j]);
      if ((ay > 0) !== (by > 0) && 0 < ((bx - ax) * (0 - ay)) / (by - ay) + ax) inside = !inside;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      if (Math.hypot(ax + u * dx, ay + u * dy) < m) return true;
    }
    return inside;
  }
  function updateXray() {
    if (!map || !map.getLayer('building-ghost')) return; // (isStyleLoaded() reads false while the route dashes animate)
    if (!routeShown || routeLine.length < 2 || map.getPitch() < 8) { xrayKey = ''; setXray(map, []); return; }
    const c = map.getCenter();
    const key = [map.areTilesLoaded(), routeLine.length, c.lng.toFixed(5), c.lat.toFixed(5), map.getZoom().toFixed(2), Math.round(map.getBearing()), Math.round(map.getPitch()), innerWidth, innerHeight].join('|');
    if (key === xrayKey) return;
    xrayKey = key;
    // points every few metres along the route, at most about 90
    let total = 0;
    for (let i = 1; i < routeLine.length; i++) total += distanceM(routeLine[i - 1], routeLine[i]);
    const step = Math.max(3, total / 90);
    const pts: LngLat[] = [routeLine[0]];
    for (let i = 1; i < routeLine.length; i++) {
      const a = routeLine[i - 1], b = routeLine[i], d = distanceM(a, b);
      for (let t = step; t < d; t += step) pts.push([a[0] + ((b[0] - a[0]) * t) / d, a[1] + ((b[1] - a[1]) * t) / d]);
      pts.push(b);
    }
    const W = map.getCanvas().clientWidth, H = map.getCanvas().clientHeight;
    const hit = new Set<string>();
    for (const p of pts) {
      const s = map.project(p);
      if (s.x < 0 || s.y < 0 || s.x > W || s.y > H) continue;
      for (const f of map.queryRenderedFeatures(s, { layers: XRAY_LAYERS })) {
        const id = f.properties?.osmId as string | undefined;
        if (!id || hit.has(id)) continue;
        const ring = footprints.get(id);
        if (ring && touches(p, ring, 3)) continue; // the route runs along or into this one: it isn't in the way
        hit.add(id);
      }
    }
    setXray(map, [...hit]);
  }
  // when the camera stops, and again once its tiles are in (cheap when nothing changed)
  map?.on('moveend', () => { if (routeShown) scheduleXray(); });
  map?.on('idle', () => { if (routeShown) updateXray(); });

  // ---------- walking: Start folds the directions into a slim bar and follows you ----------
  const LOCAL = (p: LngLat, o: LngLat) => [(p[0] - o[0]) * 111320 * Math.cos((o[1] * Math.PI) / 180), (p[1] - o[1]) * 111320];
  /** where you are along the route: metres off it, metres left to walk, and a point a little ahead */
  function along(pos: LngLat, line: LngLat[]) {
    if (line.length < 2) return { off: line.length ? distanceM(pos, line[0]) : 0, left: 0, ahead: line[0] ?? pos };
    let best = { off: Infinity, seg: 0, u: 0 };
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = LOCAL(line[i - 1], pos), [bx, by] = LOCAL(line[i], pos);
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const off = Math.hypot(ax + u * dx, ay + u * dy);
      if (off < best.off) best = { off, seg: i, u };
    }
    const a = line[best.seg - 1] ?? line[0], b = line[best.seg] ?? line[0];
    const onLine: LngLat = [a[0] + (b[0] - a[0]) * best.u, a[1] + (b[1] - a[1]) * best.u];
    let left = distanceM(onLine, b);
    for (let i = best.seg + 1; i < line.length; i++) left += distanceM(line[i - 1], line[i]);
    // 25 m further along, for which way to face at the start
    let need = 25, ahead: LngLat = b, prev = onLine;
    for (let i = best.seg; i < line.length && need > 0; i++) {
      const d = distanceM(prev, line[i]);
      if (d >= need) { const t = need / d; ahead = [prev[0] + (line[i][0] - prev[0]) * t, prev[1] + (line[i][1] - prev[1]) * t]; need = 0; break; }
      need -= d; prev = line[i]; ahead = line[i];
    }
    return { off: best.off, left, ahead };
  }
  const bearingTo = (a: LngLat, b: LngLat) => { const [x, y] = LOCAL(b, a); return (Math.atan2(x, y) * 180) / Math.PI; };
  const navText = (metres: number) => `About ${Math.max(1, Math.round(metres / config.walkingSpeedMps / 60))} min · ${formatDistance(metres)} to go`;

  function renderNav() {
    if (!current || !lastRoute) return;
    panelBody.innerHTML = `
      <div class="nav-bar">
        <span class="cat-icon g-${groupOf(current)}">${icons.walk}</span>
        <button class="nav-info" aria-label="Change the route to ${esc(current.name)}">
          <b id="panel-name" tabindex="-1">${esc(current.name)}</b>
          <span id="nav-left" class="nav-left" aria-live="polite">${navText(lastRoute.distanceM)}</span>
        </button>
        <button class="btn nav-end">End</button>
      </div>`;
    panelBody.querySelector('.nav-end')!.addEventListener('click', () => endNavigation());
    panelBody.querySelector('.nav-info')!.addEventListener('click', () => { const p = current!; leaveNavMode(); openDirections(p); });
  }
  function leaveNavMode() {
    if (!navigating) return;
    navigating = false;
    document.body.classList.remove('navigating');
    panel.classList.remove('nav');
  }
  function startNavigation() {
    if (!map || !current || !routeShown || !lastRoute) return;
    navigating = true;
    lastReroute = Date.now() - 9000; // a first new route is allowed a few seconds after Start
    offCount = 0;
    if (!welcome.hidden) dismissWelcome();
    hideResults();
    toggleKey(false);
    document.body.classList.add('navigating');
    panel.classList.add('nav');
    setExpanded(false);
    renderNav();
    track('nav-start', { id: current.id, from: fromValue === 'me' ? 'me' : 'place' });
    if (fromValue === 'me' && fix) {
      // follow you, facing the way the route goes
      if (!tracking) startTracking();
      setFollowing(true);
      const a = along(fix.pos, lastRoute.coordinates);
      const bearing = a.off < 40 ? bearingTo(fix.pos, a.ahead) : map.getBearing();
      camMove({ center: fix.pos, zoom: Math.max(map.getZoom(), 18), pitch: tilt(55), bearing, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: ms(800) });
    } else {
      // from an entrance or another building: the whole route, now with the full screen to use
      const all = [...routeLine, ...(routeFrom ? [routeFrom.position] : [])];
      setTimeout(() => fitPoints(all, { pitch: tilt(45), maxZoom: 18 }), 60);
    }
  }
  function endNavigation() {
    leaveNavMode();
    if (!current) return;
    clearRoute();
    directionsOpen = false;
    renderCard(current);
    layoutMarkers();
  }
  let lastReroute = 0;
  let offCount = 0;
  /** each new fix while walking: time left, and a fresh route if you've clearly left this one */
  function onNavFix(f: Fix) {
    if (!lastRoute || !current) return;
    const a = along(f.pos, lastRoute.coordinates);
    const out = document.querySelector('#nav-left');
    const off = a.off > 35 && f.accuracy <= 25;
    offCount = off ? offCount + 1 : 0;
    if (out && !out.classList.contains('arrived')) out.textContent = navText(a.left + (off ? a.off : 0)) + (off ? ' · off the route' : '');
    // twice in a row and not too often: a new route from where you are now (only when it started from you)
    if (offCount >= 2 && fromValue === 'me' && Date.now() - lastReroute > 15000 && distanceToBounds(f.pos, doc.bounds) === 0) {
      lastReroute = Date.now();
      offCount = 0;
      const r = router.route(f.pos, routeTarget(current), footprints);
      if (r) { drawRoute(r, f.pos, true); renderNav(); toast('New route from where you are', 2500); }
    }
  }

  // tap a building footprint (footprintToPlace picks the building, so a café doesn't take it over)
  map?.on('click', (e) => {
    hideResults();
    if (!key.hidden) toggleKey(false);
    if (navigating) return; // while walking, stray taps on the map shouldn't end the route
    const f = map!.queryRenderedFeatures(e.point, { layers: ['building-walls', 'building-roof', 'building-top', 'building-ghost'] })[0];
    const p = f && footprintToPlace.get(f.properties?.osmId);
    if (p) { select(p, { source: 'building' }); return; }
    if (current && !directionsOpen) closePanel();
  });
  map?.on('mousemove', (e) => {
    const hit = map!.queryRenderedFeatures(e.point, { layers: ['building-walls', 'building-ghost'] }).some((f) => footprintToPlace.has(f.properties?.osmId));
    map!.getCanvas().style.cursor = hit ? 'pointer' : '';
  });

  // ---------- search ----------
  const input = $<HTMLInputElement>('#q');
  const results = $('#results');
  const clearBtn = $('.search .clear');
  type Option = { kind: 'place'; place: Place } | { kind: 'group'; group: GroupId };
  let options: Option[] = [];

  function hideResults() { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  function showResults() {
    const q = input.value.trim();
    clearBtn.hidden = !input.value;
    if (!$('#list').hidden) renderList();
    if (!q) { hideResults(); return; }
    const hits = search(q, places.filter(passes), 6);
    const groups = (matchingGroups(q) as GroupId[]).filter((g) => (groupCount.get(g) ?? 0) > 0 && g !== filter);
    options = [...groups.map((group) => ({ kind: 'group' as const, group })), ...hits.map((h) => ({ kind: 'place' as const, place: h.place }))];
    const via = new Map(hits.map((h) => [h.place.id, h.via]));
    if (!options.length) {
      results.innerHTML = `<li class="empty"><p>No places match “${esc(q)}”${filter !== 'all' ? ` in ${esc(filterLabel(filter))}` : ''}.</p>
        ${filter !== 'all' ? '<button class="btn ghost reset">Search all categories</button>' : '<p class="hint">Try a building name, a code such as D1, or a room such as Ma101.</p>'}</li>`;
      results.querySelector('.reset')?.addEventListener('click', () => { setFilter('all'); input.focus(); });
    } else {
      results.innerHTML = options.map((o, i) => o.kind === 'group'
        ? `<li><button role="option" data-i="${i}"><span class="cat-icon small g-${o.group}">${groupIcon(o.group)}</span>
            <span><b>Show all: ${esc(groupLabel(o.group))}</b><small>${groupCount.get(o.group)} places</small></span></button></li>`
        : `<li><button role="option" data-i="${i}">
            <span class="cat-icon small g-${groupOf(o.place)}">${placeIcon(o.place.category, o.place.kind)}</span>
            <span><b>${esc(o.place.name)}</b>${o.place.code ? ` <span class="code">${esc(o.place.code)}</span>` : ''}
            <small>${esc([via.get(o.place.id) ?? groupLabel(groupOf(o.place)), o.place.college && COLLEGE[o.place.college]].filter(Boolean).join(' · '))}</small></span></button></li>`).join('');
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    const q = input.value.trim().toLowerCase().slice(0, 40);
    input.value = '';
    clearBtn.hidden = true;
    hideResults();
    if (o.kind === 'group') {
      setFilter(o.group);
      showWholeCampus();
      return;
    }
    track('search', { q, id: o.place.id });
    hideList();
    select(o.place, { source: 'search' });
  }
  input.addEventListener('input', showResults);
  input.addEventListener('focus', () => input.value && showResults());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !results.hidden) { e.preventDefault(); results.querySelector<HTMLElement>('button')?.focus(); }
  });
  results.addEventListener('keydown', (e) => {
    const btns = [...results.querySelectorAll<HTMLElement>('button[data-i]')];
    const i = btns.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[Math.min(i + 1, btns.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? input : btns[i - 1]).focus(); }
  });
  results.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (b) pick(Number(b.dataset.i));
  });
  $('.search').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = options.findIndex((o) => o.kind === 'place');
    pick(i >= 0 ? i : 0);
  });
  clearBtn.addEventListener('click', () => { input.value = ''; showResults(); input.focus(); });

  // ---------- list view (same data; works without the map) ----------
  const listBtn = $('#list-btn');
  function renderList() {
    const q = input.value.trim();
    const pool = (q ? search(q, places, 100).map((h) => h.place) : places).filter(passes);
    const body = $('#list-body');
    if (!pool.length) {
      body.innerHTML = `<p class="list-empty">No places match${q ? ` “${esc(q)}”` : ''}.</p>${filter !== 'all' ? '<button class="btn ghost reset">Show all categories</button>' : ''}`;
      body.querySelector('.reset')?.addEventListener('click', () => setFilter('all'));
      return;
    }
    body.innerHTML = GROUPS.filter((g) => pool.some((p) => groupOf(p) === g.id)).map((g) => `
      <h3>${g.label}</h3>
      <ul>${pool.filter((p) => groupOf(p) === g.id).sort((a, b) => a.name.localeCompare(b.name)).map((p) => `
        <li><button data-id="${p.id}"><span class="cat-icon small g-${g.id}">${placeIcon(p.category, p.kind)}</span>
          <span><b>${esc(p.name)}</b>${p.code ? ` <span class="code">${esc(p.code)}</span>` : ''}
          <small>${esc(p.description || (p.college ? COLLEGE[p.college] : ''))}</small></span></button></li>`).join('')}</ul>`).join('');
  }
  function showList(note?: string) {
    renderList();
    const n = $('#list-note');
    n.hidden = !note;
    if (note) n.textContent = note;
    $('#list').hidden = false;
    listBtn.setAttribute('aria-pressed', 'true');
    listBtn.setAttribute('aria-label', 'Show map');
    listBtn.innerHTML = icons.map;
  }
  function hideList() {
    if (!map) return; // without a map the list is the whole app
    $('#list').hidden = true;
    listBtn.setAttribute('aria-pressed', 'false');
    listBtn.setAttribute('aria-label', 'Show list of places');
    listBtn.innerHTML = icons.list;
  }
  listBtn.addEventListener('click', () => ($('#list').hidden ? showList() : hideList()));
  $('#list-body').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    const p = b && byId.get(b.dataset.id!);
    if (!p) return;
    hideList();
    select(p, { source: 'list' });
  });
  if (!map) {
    loading.hidden = true;
    document.body.classList.add('no-map');
    showList("The map can't be shown on this device, so here is every place as a list.");
  }

  // ---------- keyboard: Esc closes the top-most layer ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!welcome.hidden) dismissWelcome();
    else if (!about.hidden) closeDialog(about);
    else if (navigating) endNavigation();
    else if (!$('#ask').hidden) { $('#ask').hidden = true; pendingLocate?.(false); pendingLocate = null; }
    else if (!key.hidden) { toggleKey(false); keyBtn.focus(); }
    else if (!results.hidden) hideResults();
    else if (!$('#list').hidden) hideList();
    else if (current) closePanel();
  });

  // ---------- deep link: /?place=<id> ----------
  if (linkedId) {
    const p = byId.get(linkedId);
    const open = () => {
      if (p) select(p, { source: 'link' });
      else { history.replaceState(null, '', location.pathname); toast("Sorry, we couldn't find that place. Here's the whole campus.", 6000); }
    };
    if (map && !map.loaded()) map.once('load', open);
    else open();
  }

  // ---------- offline (installable PWA, from the original brief) ----------
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const register = () => navigator.serviceWorker.register('/sw.js');
    if (document.readyState === 'complete') register();
    else addEventListener('load', register);
  }
}
