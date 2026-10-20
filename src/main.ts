import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { config } from './config';
import { loadData } from './data';
import { applyTheme, bounceBuilding, createMap, lineFeature, selectBuilding, setGeoJSON, type Theme } from './map';
import { icons, placeIcon } from './icons';
import { matchingGroups, search } from './search';
import { circle, distanceToBounds, formatDistance, getFix, startCompass, type Fix } from './geo';
import { Router, type Route } from './route';
import { londonNow, openState, todayText } from './hours';
import { initAnalytics, track } from './analytics';
import { GROUPS, PRIORITY, groupLabel, groupOf, type GroupId } from './categories';
import type { LngLat, Place } from './types';

// ---------- small helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ms = (d: number) => (reducedMotion.matches ? 0 : d);
const isDesktop = () => innerWidth >= 900;
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const COLLEGE: Record<string, string> = { 'digby-stuart': 'Digby Stuart', froebel: 'Froebel', southlands: 'Southlands' };
/** icon for a whole category (chips, key, "show all" suggestions) */
const groupIcon = (g: GroupId) =>
  g === 'entrance' ? icons.entrance : placeIcon(g === 'food' ? 'food' : g === 'sport' ? 'sport' : 'building', g === 'services' ? 'service' : g);

$$('[data-icon]').forEach((el) => (el.innerHTML = icons[el.dataset.icon as keyof typeof icons] ?? ''));
$$('.author').forEach((el) => (el.textContent = config.author));
$$<HTMLAnchorElement>('.ig').forEach((a) => (a.href = config.links.instagram));
$$<HTMLAnchorElement>('.li').forEach((a) => (a.href = config.links.linkedin));
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
  const open = $$('.welcome, .about').find((d) => !d.hidden);
  if (!open || e.key !== 'Tab') return;
  const f = $$('button, a[href]').filter((x) => open.contains(x));
  const [first, last] = [f[0], f[f.length - 1]];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

const linkedId = new URLSearchParams(location.search).get('place');
const welcome = $('#welcome');
// direct links to a building skip the welcome
if (!linkedId && !store.get('roam.welcomed')) openDialog(welcome, $('#welcome-go'));
const dismissWelcome = () => { store.set('roam.welcomed', '1'); closeDialog(welcome); };
$('#welcome-go').addEventListener('click', dismissWelcome);
welcome.addEventListener('click', (e) => { if (e.target === welcome) dismissWelcome(); });

const about = $('#about');
$('#about-btn').addEventListener('click', () => openDialog(about, $('.about-close')));
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

  // ---------- map (falls back to the list if WebGL is unavailable) ----------
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const theme = (): Theme => (darkQuery.matches ? 'dark' : 'light');
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
    darkQuery.addEventListener('change', () => applyTheme(map!, theme()));
    if (import.meta.env.DEV) Object.assign(window, { map });
  }

  const campusCenter: LngLat = (() => {
    const pts = places.filter((p) => p.category !== 'entrance').map((p) => p.position);
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  })();
  const homeZoom = () => (innerWidth < 500 ? 16.1 : 16.7);
  map?.jumpTo({ center: campusCenter, zoom: homeZoom() });
  const campusPoints = places.filter((p) => p.category !== 'entrance').map((p) => p.position);

  // ---------- state ----------
  let current: Place | null = null;
  let directionsOpen = false;
  let routeShown = false;
  let routeFrom: Place | null = null;
  let filter: GroupId | 'all' = 'all';
  const passes = (p: Place) => filter === 'all' || groupOf(p) === filter;

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
      : `<span class="dot">${placeIcon(p.category, p.kind)}</span><span class="label">${p.code ? `<b>${esc(p.code)}</b> ` : ''}${esc(p.name)}</span>`;
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

  // Fewer markers when zoomed out, more detail when zoomed in. Runs on moveend only (not every
  // frame): greedy by category priority, the selected place and route start always show.
  function layoutMarkers() {
    if (!map) return;
    const z = map.getZoom();
    document.body.classList.toggle('compact-pins', z < 16.6);
    const gap = z < 16 ? 30 : z < 17 ? 26 : 22;
    const W = innerWidth, H = innerHeight;
    const dots: [number, number][] = [];
    const labels: [number, number, number, number][] = [];
    const isSel = (m: M) => m.p.id === current?.id || m.p.id === routeFrom?.id;
    const list = [...markers.values()].sort((a, b) => Number(isSel(b)) - Number(isSel(a)) || PRIORITY[b.group] - PRIORITY[a.group]);
    const shown: { m: M; x: number; y: number; sel: boolean }[] = [];
    for (const m of list) {
      const sel = isSel(m);
      const filtered = m.group !== 'entrance' && !passes(m.p);
      const tooFar = m.group === 'entrance' && z < 16.3;
      let show = sel || (!filtered && !tooFar);
      const pt = map.project(m.p.position);
      const x = pt.x + m.offset[0], y = pt.y + m.offset[1];
      const onScreen = x > -40 && x < W + 40 && y > -40 && y < H + 40;
      if (show && onScreen && !sel && dots.some(([a, b]) => Math.hypot(a - x, b - y) < gap)) show = false;
      m.el.classList.toggle('hidden', !show);
      m.el.tabIndex = show ? 0 : -1;
      m.el.classList.remove('show-label');
      if (show && onScreen) { dots.push([x, y]); shown.push({ m, x, y, sel }); }
    }
    // second pass: labels (from zoom 17) only where they cover neither another label nor a dot
    for (const { m, x, y, sel } of shown) {
      if (!sel && z < 17) continue;
      if (!m.labelW) m.labelW = m.el.querySelector<HTMLElement>('.label')!.offsetWidth || 120;
      const box: [number, number, number, number] = [x - m.labelW / 2, y + 14, x + m.labelW / 2, y + 36];
      const hitsDot = dots.some(([dx, dy]) => (dx !== x || dy !== y) && dx + 12 > box[0] && dx - 12 < box[2] && dy + 12 > box[1] && dy - 12 < box[3]);
      const hitsLabel = labels.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b);
      if (sel || (!hitsDot && !hitsLabel)) { labels.push(box); m.el.classList.add('show-label'); }
    }
  }
  map?.on('moveend', layoutMarkers);
  map?.once('load', layoutMarkers);
  addEventListener('resize', () => layoutMarkers());

  // ---------- filters ----------
  const chips = $('#chips');
  const visibleGroups = GROUPS.filter((g) => g.id !== 'entrance' && (groupCount.get(g.id) ?? 0) > 0); // never show empty categories
  chips.innerHTML = `<button class="chip" data-filter="all" aria-pressed="true">All</button>` +
    visibleGroups.map((g) => `<button class="chip" data-filter="${g.id}" aria-pressed="false" aria-label="${g.label}"><span class="chip-dot g-${g.id}">${groupIcon(g.id)}</span>${g.short}</button>`).join('');
  function setFilter(f: GroupId | 'all') {
    filter = f;
    $$('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === f)));
    $(`.chip[data-filter="${f}"]`).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: ms(1) ? 'smooth' : 'auto' });
    layoutMarkers();
    if (!$('#list').hidden) renderList();
    if (input.value) showResults();
  }
  chips.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.chip');
    // tapping the active chip again resets to All
    if (c) setFilter((c.dataset.filter === filter ? 'all' : c.dataset.filter) as GroupId | 'all');
  });

  // ---------- map key ----------
  const key = $('#key');
  key.innerHTML = `<h3>Key</h3><ul>` +
    visibleGroups.map((g) => `<li><span class="chip-dot g-${g.id}">${groupIcon(g.id)}</span>${g.label}</li>`).join('') +
    `<li><span class="chip-dot g-entrance">${icons.entrance}</span>Campus entrance</li></ul>
    <h4>Roof colours</h4><ul>
      <li><span class="swatch roof-digby"></span>Digby Stuart</li>
      <li><span class="swatch roof-froebel"></span>Froebel</li>
      <li><span class="swatch roof-southlands"></span>Southlands</li>
      <li><span class="swatch roof-other"></span>Other university building</li>
    </ul>
    <ul><li><span class="swatch line-path"></span>Footpath</li><li><span class="swatch line-road"></span>Road</li><li><span class="swatch line-route"></span>Walking route</li></ul>`;
  const keyBtn = $('#key-btn');
  const toggleKey = (open = key.hidden) => { key.hidden = !open; keyBtn.setAttribute('aria-expanded', String(open)); };
  keyBtn.addEventListener('click', () => toggleKey());

  // ---------- map controls ----------
  $('#zoom-in').addEventListener('click', () => map?.zoomIn({ duration: ms(250) }));
  $('#zoom-out').addEventListener('click', () => map?.zoomOut({ duration: ms(250) }));
  $('#north').addEventListener('click', () => map?.easeTo({ bearing: 0, pitch: 55, duration: ms(400) }));
  $('#whole').addEventListener('click', () => showWholeCampus());
  // Phones are tall and the campus runs south-west to north-east, so the phone overview faces
  // north-east (like the official campus map, turned to portrait). The compass button resets to north.
  const PHONE_BEARING = 28;
  function showWholeCampus(duration = 500) {
    if (!map) return;
    const phone = !isDesktop();
    fitPoints(campusPoints, { pitch: phone ? 45 : 55, bearing: phone ? PHONE_BEARING : 0, maxZoom: 17, fullWidth: phone, duration });
  }
  if (!linkedId) map?.once('load', () => showWholeCampus(0));
  const northIcon = $('#north svg');
  map?.on('rotate', () => { northIcon.style.transform = `rotate(${-map!.getBearing()}deg)`; drawHeading(); });

  // ---------- location: one fix, only when asked ----------
  let fix: Fix | null = null;
  let compassHeading: number | null = null;
  let stopCompass: (() => void) | null = null;
  const avatarEl = document.createElement('div');
  avatarEl.className = 'avatar';
  avatarEl.innerHTML = '<div class="arrow" hidden></div><div class="body"></div>';
  const avatar = new maplibregl.Marker({ element: avatarEl, anchor: 'center' });

  function drawHeading() {
    const arrow = avatarEl.querySelector<HTMLElement>('.arrow')!;
    const h = compassHeading ?? fix?.heading ?? null;
    arrow.hidden = h == null; // no compass, or permission refused: no arrow
    if (h != null && map) arrow.style.transform = `rotate(${h - map.getBearing()}deg)`;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopCompass?.(); stopCompass = null; compassHeading = null; drawHeading(); }
  });

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
    avatar.setLngLat(f.pos).addTo(map);
    setGeoJSON(map, 'user', { type: 'Feature', properties: {}, geometry: circle(f.pos, f.accuracy) });
    drawHeading();
    $('#findme').classList.add('active');
    const off = distanceToBounds(f.pos, doc.bounds);
    if (off > 0) { toast(`You're not on campus yet · ${formatDistance(off)} away`, 6000); return; }
    if (f.accuracy > config.weakGpsM) toast(`GPS is weak here · accurate to about ${Math.round(f.accuracy)} m`, 5000);
    if (!routeShown) map.easeTo({ center: f.pos, zoom: Math.max(map.getZoom(), 17.2), duration: ms(500) });
  }
  $('#findme').addEventListener('click', async () => {
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
    current = null;
    directionsOpen = false;
    clearRoute();
    panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, ms(180));
    $$('.pin.selected').forEach((el) => el.classList.remove('selected'));
    if (map) selectBuilding(map, null);
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
    const box = opts.fullWidth
      ? { l: 22, r: W - 22, t: a.top + 30, b: Math.min(a.bottom, H) - 8 }
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
      s.kind === 'open' ? ['open', `Open now · until ${s.until}`]
      : s.kind === 'opens-later' ? ['closed', `Closed · opens ${s.at}`]
      : s.kind === 'closed-today' ? ['closed', 'Closed today']
      : ['unknown', "Today's hours not published"];
    return `<div class="hours"><span class="badge ${cls}">${text}</span><span class="today">${todayText(p.hours)}</span></div>
      ${p.hours.notes ? `<p class="notes">${esc(p.hours.notes)}</p>` : ''}`;
  }

  function renderCard(p: Place) {
    const g = groupOf(p);
    const mail = `mailto:${config.reportEmail}?subject=${encodeURIComponent(`Roam mistake: ${p.name}`)}&body=${encodeURIComponent(`What's wrong?\n\n\n(place id: ${p.id})`)}`;
    const src = p.sources?.[0];
    const checked = src?.checked ?? p.lastVerified;
    panelBody.innerHTML = `
      <div class="p-head">
        <span class="cat-icon g-${g}">${placeIcon(p.category, p.kind)}</span>
        <div class="titles">
          <h2 id="panel-name" tabindex="-1">${esc(p.name)}</h2>
          <p class="meta">${[p.code && `<span class="code">${esc(p.code)}</span>`, esc(groupLabel(g)), p.college && COLLEGE[p.college]].filter(Boolean).join(' · ')}</p>
        </div>
        <button class="icon-btn close" aria-label="Close">${icons.close}</button>
      </div>
      ${p.photo ? `<img class="photo" src="/${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="1200" height="675">` : ''}
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
      ${p.services?.length ? `<ul class="services" aria-label="Services">${p.services.map((s, i) => `<li${i >= 4 ? ' hidden' : ''}>${esc(s)}</li>`).join('')}${p.services.length > 4 ? `<li><button class="more" aria-label="Show ${p.services.length - 4} more services">+${p.services.length - 4} more</button></li>` : ''}</ul>` : ''}
      ${hoursBlock(p)}
      ${p.accessibility ? `<p class="access"><a href="${esc(p.accessibility.url)}" target="_blank" rel="noopener">${icons.accessible}<span>${esc(p.accessibility.summary)}</span></a></p>` : ''}
      <div class="actions">
        <button class="btn primary dir">${icons.directions}<span>Directions</span></button>
        <button class="btn ghost share" aria-label="Share a link to ${esc(p.name)}">${icons.share}<span>Share</span></button>
      </div>
      ${p.officialUrl ? `<a class="official" href="${esc(p.officialUrl)}" target="_blank" rel="noopener">Official page ${icons.external}</a>` : ''}
      <p class="small">
        ${src ? `Source: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>${checked ? `, checked ${fmtDate(checked)}` : ''} · ` : checked ? `Last checked ${fmtDate(checked)} · ` : ''}
        <a href="${mail}">Report a mistake</a>
      </p>`;
    panelBody.querySelector('.close')!.addEventListener('click', closePanel);
    panelBody.querySelector('.dir')!.addEventListener('click', () => openDirections(p));
    panelBody.querySelector('.share')!.addEventListener('click', () => share(p));
    panelBody.querySelector('.more')?.addEventListener('click', (e) => {
      panelBody.querySelectorAll<HTMLElement>('.services li[hidden]').forEach((li) => (li.hidden = false));
      (e.target as HTMLElement).closest('li')!.remove();
    });
    // a missing photo simply disappears
    panelBody.querySelector<HTMLImageElement>('.photo')?.addEventListener('error', (e) => (e.target as HTMLElement).remove());
  }

  function select(p: Place, opts: { source: 'marker' | 'building' | 'search' | 'link' | 'list' }) {
    if (current?.id !== p.id) clearRoute();
    current = p;
    directionsOpen = false;
    renderCard(p);
    openPanel();
    $$('.pin.selected').forEach((el) => el.classList.remove('selected'));
    markers.get(p.id)?.el.classList.add('selected');
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
    const r = router.route(from, to, footprints);
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
      <ul class="route-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      <p class="small">Follows footpaths and campus roads mapped on OpenStreetMap. Step-free routes aren't available yet.</p>`;
  }

  function drawRoute(r: Route, from: LngLat | Place) {
    if (!map) return;
    routeShown = true;
    setGeoJSON(map, 'route', lineFeature(r.coordinates));
    setGeoJSON(map, 'hop', lineFeature(r.startHop));
    startMarker.setLngLat(Array.isArray(from) ? from : from.position).addTo(map);
    endMarker.setLngLat(r.coordinates[r.coordinates.length - 1]).addTo(map);
    const all = [...r.coordinates, ...r.startHop, Array.isArray(from) ? from : from.position];
    // a lower tilt for the overview, so the far end of a long route stays readable
    requestAnimationFrame(() => fitPoints(all, { pitch: 40, maxZoom: 18 }));
  }
  function clearRoute() {
    routeShown = false;
    routeFrom = null;
    startMarker.remove();
    endMarker.remove();
    if (!map) return;
    setGeoJSON(map, 'route', { type: 'FeatureCollection', features: [] });
    setGeoJSON(map, 'hop', { type: 'FeatureCollection', features: [] });
  }

  // tap a building footprint (buildings first, so a café doesn't take over its building)
  const footprintToPlace = new Map(places.filter((p) => p.footprintId && p.category === 'building').map((p) => [p.footprintId!, p]));
  for (const p of places) if (p.footprintId && !footprintToPlace.has(p.footprintId)) footprintToPlace.set(p.footprintId, p);
  map?.on('click', (e) => {
    hideResults();
    if (!key.hidden) toggleKey(false);
    const f = map!.queryRenderedFeatures(e.point, { layers: ['building-walls', 'building-roof'] })[0];
    const p = f && footprintToPlace.get(f.properties?.osmId);
    if (p) { select(p, { source: 'building' }); return; }
    if (current && !directionsOpen) closePanel();
  });
  map?.on('mousemove', (e) => {
    const hit = map!.queryRenderedFeatures(e.point, { layers: ['building-walls'] }).some((f) => footprintToPlace.has(f.properties?.osmId));
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
      results.innerHTML = `<li class="empty"><p>No places match “${esc(q)}”${filter !== 'all' ? ` in ${esc(groupLabel(filter).toLowerCase())}` : ''}.</p>
        ${filter !== 'all' ? '<button class="btn ghost reset">Search all categories</button>' : '<p class="hint">Try a building name, a code such as D1, or a room such as Ma101.</p>'}</li>`;
      results.querySelector('.reset')?.addEventListener('click', () => { setFilter('all'); input.focus(); });
    } else {
      results.innerHTML = options.map((o, i) => o.kind === 'group'
        ? `<li><button role="option" data-i="${i}"><span class="cat-icon small g-${o.group}">${groupIcon(o.group)}</span>
            <span><b>Show all: ${esc(groupLabel(o.group))}</b><small>${groupCount.get(o.group)} places</small></span></button></li>`
        : `<li><button role="option" data-i="${i}">
            <span class="cat-icon small g-${groupOf(o.place)}">${placeIcon(o.place.category, o.place.kind)}</span>
            <span><b>${esc(o.place.name)}</b>${o.place.code ? ` <span class="code">${esc(o.place.code)}</span>` : ''}
            <small>${esc(via.get(o.place.id) ?? groupLabel(groupOf(o.place)))}</small></span></button></li>`).join('');
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
