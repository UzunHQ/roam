import './style.css';
import type { EaseToOptions, LngLat as MLLngLat, Map as MLMap, Marker as MLMarker, MarkerOptions } from 'maplibre-gl';
import { config } from './config';
import { loadData } from './data';
import type { Theme } from './map';
import { icons, placeIcon } from './icons';
import { matchingGroups, parseRoom, search } from './search';
import { circle, distanceM, distanceToBounds, formatDistance, getFix, startCompass, watchFix, type Fix } from './geo';
import { avatarSvg } from './avatar';
import { Router, type Route } from './route';
import { routeSteps } from './steps';
import { isOpenNow, openState, refreshLiveHours, resolveHours, weekRows, type OpenState } from './hours';
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
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* private mode: fine */ } },
};
// Animations: Full, Reduced or Off. Starts from the phone's Reduce Motion setting; Settings can override it.
type Motion = 'full' | 'reduced' | 'off';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionChoice = (): Motion | null => { const v = store.get('roam.motion'); return v === 'full' || v === 'reduced' || v === 'off' ? v : null; };
const motion = (): Motion => motionChoice() ?? (reducedMotion.matches ? 'reduced' : 'full');
const applyMotion = () => { document.documentElement.dataset.motion = motion(); document.dispatchEvent(new Event('roam-motion')); };
applyMotion();
reducedMotion.addEventListener('change', applyMotion);
// Theme: System (follows the phone's light or dark mode) unless Light or Dark is chosen in Settings.
type ThemePref = 'system' | 'light' | 'dark';
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const themePref = (): ThemePref => { const v = store.get('roam.theme'); return v === 'light' || v === 'dark' ? v : 'system'; };
const themeChoice = (): Theme => { const p = themePref(); return p === 'system' ? (darkScheme.matches ? 'dark' : 'light') : p; };
function applyThemeChoice() {
  const t = themeChoice();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#1f2e28' : '#cfe3be');
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', t);
  document.dispatchEvent(new Event('roam-theme'));
}
applyThemeChoice();
darkScheme.addEventListener('change', () => { if (themePref() === 'system') applyThemeChoice(); });
// low-end phones skip the purely decorative motion (pond ripples, drifting route dashes)
const nav = navigator as Navigator & { deviceMemory?: number };
const lite = (nav.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency ?? 8) <= 2;
document.documentElement.classList.toggle('lite', lite);
/** animation length, or 0 (jump) unless motion is Full */
const ms = (d: number) => (motion() === 'full' ? d : 0);
const isDesktop = () => innerWidth >= 900;
/** a place's name inside a sentence: "the Library", "the Main entrance", but "Shaw House", "Froebel Gate" */
const PROPER = /(House|Building|Hall|Court|Centre|Auditorium|Mausoleum|Chapel|Gate|Grove|Square|Diner|Costa|Londis.*)( (North|South|East|West))?$/;
const theName = (name: string) => (/^The /.test(name) ? name.replace(/^The /, 'the ') : PROPER.test(name) ? name : `the ${name}`);
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const COLLEGE: Record<string, string> = { 'digby-stuart': 'Digby Stuart', froebel: 'Froebel', southlands: 'Southlands' };
/** icon for a whole category (chips, key, "show all" suggestions) */
const groupIcon = (g: GroupId) =>
  g === 'entrance' ? icons.entrance : g === 'nearby' ? icons.bus : placeIcon(g === 'food' ? 'food' : g === 'sport' ? 'sport' : 'building', g === 'services' ? 'service' : g);

$$('[data-icon]').forEach((el) => (el.innerHTML = icons[el.dataset.icon as keyof typeof icons] ?? ''));
$$('.author').forEach((el) => (el.textContent = config.author));
// an empty link in config.ts hides its icon
$$<HTMLAnchorElement>('[data-link]').forEach((a) => {
  const url = config.links[a.dataset.link as keyof typeof config.links] ?? '';
  a.href = url;
  a.hidden = !url;
});
initAnalytics();
// the height you can actually see: smaller while a phone keyboard is up, so search results stay above it
const setVisibleHeight = () => document.documentElement.style.setProperty('--vv-h', `${Math.round(window.visualViewport?.height ?? innerHeight)}px`);
setVisibleHeight();
window.visualViewport?.addEventListener('resize', setVisibleHeight);

let toastTimer = 0;
function toast(msg: string, time = 4500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (time) toastTimer = window.setTimeout(() => (t.hidden = true), time);
}

// ---------- dialogs: welcome, about, settings (focus kept inside, Esc closes) ----------
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
  // radios: only the checked one of each group is a Tab stop
  const f = $$('button, a[href], input').filter((x) => open.contains(x) && (!(x instanceof HTMLInputElement) || x.checked));
  const [first, last] = [f[0], f[f.length - 1]];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/** places that were split or renamed: old links and saved lists still find them */
const MOVED: Record<string, string> = { 'chadwick-hall': 'chadwick-hall-south' };
const movedId = (id: string) => MOVED[id] ?? id;
const linkedId = ((id) => id && movedId(id))(new URLSearchParams(location.search).get('place'));
const linkedRoom = new URLSearchParams(location.search).get('room');
const welcome = $('#welcome');
// The welcome card shows until you close it (X, Esc, Find me or Explore), then never again on this
// device. Direct links to a building skip it. While it's open the mascot waves now and then.
const welcomeMascot = $('.welcome-mascot');
welcomeMascot.innerHTML = avatarSvg.replace('width="48" height="63"', '');
$('.detail-mascot').innerHTML = avatarSvg.replace('width="48" height="63"', '');
let waveTimer = 0;
const dismissWelcome = () => {
  clearTimeout(waveTimer);
  store.set('roam.welcomed', '1');
  if (welcome.hidden) return;
  document.body.classList.remove('hello-open');
  welcome.classList.add('bye');
  setTimeout(() => { welcome.hidden = true; welcome.classList.remove('bye'); }, ms(200));
};
/** a short wave, 4 in all, about every 8-10 s; never with reduced or no motion */
function waveLater(left: number, delay: number) {
  waveTimer = window.setTimeout(() => {
    if (welcome.hidden) return;
    if (motion() === 'full' && !reducedMotion.matches) {
      welcomeMascot.classList.remove('waving');
      void welcomeMascot.offsetWidth; // restart the animation
      welcomeMascot.classList.add('waving');
    }
    if (left > 1) waveLater(left - 1, 8000 + Math.random() * 2000);
  }, delay);
}
welcomeMascot.addEventListener('animationend', (e) => { if (e.animationName === 'wave-hello') welcomeMascot.classList.remove('waving'); });
function showWelcome() {
  clearTimeout(waveTimer);
  welcome.hidden = false;
  document.body.classList.add('hello-open');
  waveLater(4, 1200);
}
if (!linkedId && store.get('roam.welcomed') !== '1') showWelcome();
$('#welcome-go').addEventListener('click', dismissWelcome);
$('.hello-close').addEventListener('click', dismissWelcome);
// "Find me" on the card does what the locate button does
$('#welcome-find').addEventListener('click', () => { dismissWelcome(); $('#findme').click(); });

const about = $('#about');
$('#about-btn').addEventListener('click', () => openDialog(about, $('.about-close')));
$('.about-close').addEventListener('click', () => closeDialog(about));
about.addEventListener('click', (e) => { if (e.target === about) closeDialog(about); });

// Settings (the gear in the search bar): theme and animations, remembered on this device
const settings = $('#settings');
function openSettings() {
  $$<HTMLInputElement>('input[name=theme]').forEach((r) => (r.checked = r.value === themePref()));
  $$<HTMLInputElement>('input[name=motion]').forEach((r) => (r.checked = r.value === motion()));
  openDialog(settings, $('#settings-close'));
}
settings.addEventListener('change', (e) => {
  const r = e.target as HTMLInputElement;
  if (r.name === 'theme') { store.set('roam.theme', r.value); applyThemeChoice(); }
  if (r.name === 'motion') { store.set('roam.motion', r.value); applyMotion(); }
});
$('#settings-close').addEventListener('click', () => closeDialog(settings));
// forget that the welcome card was closed, and show it now
$('#welcome-again').addEventListener('click', () => {
  store.del('roam.welcomed');
  closeDialog(settings);
  showWelcome();
  $('#welcome-go').focus();
});
settings.addEventListener('click', (e) => { if (e.target === settings) closeDialog(settings); });

$('#settings-btn').addEventListener('click', openSettings);

// ---------- start ----------
// The map (MapLibre, about 250 KB compressed, and our 3D style) is its own file. It starts loading
// now, alongside the campus data, and is skipped entirely where WebGL2 is missing: the list then
// carries the app. If it fails to load, the list takes over too.
const hasWebGL2 = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
const mapModule = hasWebGL2 ? import('./map').catch((err) => { console.error(err); return null; }) : Promise.resolve(null);

/** stands in for map markers when there is no map: every call does nothing */
class NoMarker {
  constructor(_o?: MarkerOptions) {}
  setLngLat() { return this; }
  addTo() { return this; }
  remove() { return this; }
  setOffset() { return this; }
}

main().catch((err) => {
  console.error(err);
  const l = $('#loading');
  l.hidden = false;
  l.innerHTML = navigator.onLine === false
    ? `<span>You seem to be offline, and the campus data isn't saved on this device yet. Connect once and Roam will work offline after that.</span> <button class="btn primary" id="retry">Try again</button>`
    : `<span>Sorry, the campus data didn't load. Check your connection and try again.</span> <button class="btn primary" id="retry">Try again</button>`;
  $('#retry').addEventListener('click', () => location.reload());
});

async function main() {
  const [{ doc, places, campus, walls, paths }, mapMod] = await Promise.all([loadData(), mapModule]);
  const { applyTheme, bounceBuilding, clearTreesAlong, createMap, lineFeature, pickHalf, selectBuilding, setGeoJSON, setXray } = mapMod ?? ({} as NonNullable<typeof mapMod>);
  const Marker = (mapMod?.maplibregl.Marker ?? NoMarker) as unknown as new (o?: MarkerOptions) => MLMarker;
  const byId = new Map(places.map((p) => [p.id, p]));
  const groupCount = new Map<GroupId, number>();
  for (const p of places) groupCount.set(groupOf(p), (groupCount.get(groupOf(p)) ?? 0) + 1);
  const footprints = new Map<string, LngLat[]>();
  const outlines = new Map<string, LngLat[][]>(); // all parts of a building (Davies has three)
  for (const f of campus.features) {
    if (f.properties?.layer !== 'building' || f.geometry.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as LngLat[];
    footprints.set(f.properties.osmId, ring);
    outlines.set(f.properties.osmId, [...(outlines.get(f.properties.osmId) ?? []), ring]);
  }
  // a block selected in halves (Elm Grove / Elm Grove Hall): each place's footprint is its own half
  for (const f of campus.features) {
    if (f.properties?.layer !== 'half' || f.geometry.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as LngLat[];
    footprints.set(f.properties.osmId, ring);
    outlines.set(f.properties.osmId, [ring]);
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
  if (mapMod) {
    try {
      map = createMap({ container: 'map', campus, walls, bounds: doc.bounds, theme: theme() });
    } catch (err) {
      console.error(err);
    }
  }
  const loading = $('#loading');
  /** the status box is gone for good once the map (or the list) is up, so screen readers don't find it later */
  const doneLoading = () => { loading.hidden = true; loading.textContent = ''; };
  if (map) {
    const slow = setTimeout(() => { loading.textContent = 'The map is taking a while. You can use the list view in the meantime.'; }, 10000);
    map.once('load', () => { clearTimeout(slow); doneLoading(); });
    document.addEventListener('roam-theme', () => applyTheme(map!, theme()));
    if (import.meta.env.DEV) Object.assign(window, { map, roamDebug: { route: () => lastRoute, home: () => ({ box: homeBox(map!.getCanvas().clientWidth, map!.getCanvas().clientHeight), points: campusPoints }) } });
  }

  // places off campus (the golf course next door) don't count towards the campus's own extent
  const onCampus = (p: Place) => p.category !== 'entrance' && p.college !== null;
  const campusCenter: LngLat = (() => {
    const pts = places.filter(onCampus).map((p) => p.position);
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  })();
  const homeZoom = () => (innerWidth < 500 ? 16.1 : 16.7);
  // The home view: the four parts of campus (Southlands, Digby Stuart, Froebel and Chadwick Hall)
  // filling the screen, a little tilted. On a wide screen it faces north-east, like the university's
  // own campus map (40°: the campus fills the most of the screen); on a phone held upright it faces north (as wide a view as any angle there, and a turn of the
  // fingers near north snaps back to it anyway), so the campus's long side (north
  // to south, Southlands down to Chadwick Hall) runs up the screen.
  const HOME = { get bearing() { return isDesktop() ? 40 : 0; }, get pitch() { return isDesktop() ? 50 : 45; } };
  map?.jumpTo({ center: campusCenter, zoom: homeZoom(), bearing: HOME.bearing, pitch: HOME.pitch });
  // Every deliberate camera move goes through here: live GPS following waits for it to finish
  // instead of cutting it short (MapLibre's easeTo stops whatever move is running).
  let camBusyUntil = 0;
  const camMove = (opts: EaseToOptions) => { camBusyUntil = Date.now() + (opts.duration ?? 0) + 80; map?.easeTo(opts); };
  /** a longer move (to a chosen place): a short flight, or a jump with Reduced/Off motion */
  const camFly = (opts: EaseToOptions) => {
    if (!opts.duration) { camMove(opts); return; }
    camBusyUntil = Date.now() + opts.duration + 80;
    map?.flyTo({ ...opts, curve: 1.2, essential: true });
  };
  // the home view frames the campus itself: its wall and gates, and every campus building (its
  // footprint's corners). The park to the west and the houses across the road are left out.
  const campusPoints: LngLat[] = places.filter(onCampus).map((p) => p.position);
  for (const f of walls.features) {
    if ((f.properties?.part === 'wall' || f.properties?.part === 'gate') && f.geometry.type === 'LineString') campusPoints.push(...(f.geometry.coordinates as LngLat[]));
  }
  for (const f of campus.features) {
    if (f.properties?.layer !== 'building' || f.properties?.campus === false || f.geometry.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as LngLat[];
    const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1]);
    campusPoints.push([Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)], [Math.max(...xs), Math.min(...ys)]);
  }

  // ---------- state ----------
  let current: Place | null = null;
  let currentRoom: string | null = null; // a timetable room code searched for ("Ma101"): only its building is known
  let directionsOpen = false;
  let routeShown = false;
  let routeFrom: Place | null = null;
  let navigating = false; // after Start: the directions fold into a slim bar and the map follows you
  let navId = 0; // counts walks, so a timer from an earlier one can't end the next
  let lastRoute: Route | null = null;
  let routeLine: LngLat[] = []; // the whole route, start hop included (for see-through buildings)
  let filter: Filter = 'all';
  // saved places live on this phone only
  const saved = new Set<string>((() => { try { return JSON.parse(store.get('roam.saved') ?? '[]') as string[]; } catch { return []; } })().map(movedId).filter((id) => byId.has(id)));
  // "Open now" (Food and Study only): places without listed hours can't be shown as open, so they drop out
  let openOnly = false;
  const openApplies = () => chipOf(filter) === 'food' || chipOf(filter) === 'study';
  const inFilter = (p: Place) => (filter === 'saved' ? saved.has(p.id) : passesFilter(filter, groupOf(p)));
  const passes = (p: Place) => inFilter(p) && (!openOnly || !openApplies() || isOpenNow(p.id));

  // ---------- markers ----------
  type M = { p: Place; group: GroupId; marker: MLMarker; el: HTMLButtonElement; offset: [number, number]; labelW: number; at: LngLat; gate: boolean };
  const markers = new Map<string, M>();
  // a named entrance's pin stands over its garden gate in the wall (data/walls.geojson)
  const gateAt = new Map<string, LngLat>();
  for (const f of walls.features) {
    if (f.properties?.part !== 'gate' || !f.properties.place || f.geometry.type !== 'LineString') continue;
    const [a, b] = f.geometry.coordinates;
    gateAt.set(f.properties.place, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  for (const p of places) {
    const group = groupOf(p);
    const el = document.createElement('button');
    el.className = `pin g-${group} hidden`; // shown by layoutMarkers once the map has loaded, never at made-up spots before
    el.tabIndex = -1;
    el.setAttribute('aria-label', `${p.name}, ${groupLabel(group)}`);
    el.innerHTML = group === 'entrance'
      ? `<span class="gate">${icons.entrance}</span><span class="label">${esc(p.name)}</span>`
      : `<span class="dot">${placeIcon(p.category, p.kind)}</span><span class="label"><span class="lname">${esc(p.name)}</span>${p.code ? `<span class="lcode">${esc(p.code)}</span>` : ''}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); select(p, { source: 'marker' }); });
    const at = gateAt.get(p.id) ?? p.position;
    const marker = new Marker({ element: el, anchor: 'center' }).setLngLat(at);
    if (map) marker.addTo(map);
    markers.set(p.id, { p, group, marker, el, offset: [0, 0], labelW: 0, at, gate: gateAt.has(p.id) });
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
  // (Chadwick Hall, Froebel's halls down the road, gets its own: it is a walk from the rest of Froebel)
  const isChadwick = (p: Place) => p.id.startsWith('chadwick-hall') || p.id === 'downshire-house';
  const AREAS = [
    ...(['digby-stuart', 'froebel', 'southlands'] as const).map((college) => ({ key: college, name: COLLEGE[college], what: 'college', of: (p: Place) => p.college === college && !isChadwick(p) })),
    { key: 'chadwick', name: 'Chadwick Hall', what: 'halls', of: (p: Place) => isChadwick(p) && p.category === 'building' && p.kind === 'accommodation' },
  ];
  const areas = AREAS.map(({ key, name, what, of }) => {
    const pts = places.filter((p) => of(p) && p.category !== 'entrance').map((p) => p.position);
    const c: LngLat = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    const el = document.createElement('button');
    el.className = `area-label area-${key} hidden`;
    el.tabIndex = -1;
    el.innerHTML = `<span class="area-icon">${icons.campus}</span><span>${name}</span>`;
    el.setAttribute('aria-label', `${name} ${what}: zoom in`);
    // straight to the college at street level (where building names take over)
    el.addEventListener('click', (e) => { e.stopPropagation(); setFollowing(false); camMove({ center: c, zoom: 16.9, pitch: tilt(50), duration: ms(600) }); });
    const marker = new Marker({ element: el, anchor: 'center' }).setLngLat(c);
    if (map) marker.addTo(map);
    return { el, c, marker };
  });

  // ---------- tennis court numbers, painted flat on the MUGA (close up only, not tappable) ----------
  for (const f of campus.features) {
    if (f.properties?.layer !== 'courtlabel' || f.geometry.type !== 'Point' || !map) continue;
    const el = document.createElement('div');
    el.className = 'court-label';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = String(f.properties.name);
    new Marker({ element: el, anchor: 'center', pitchAlignment: 'map', rotationAlignment: 'map' }).setLngLat(f.geometry.coordinates as LngLat).addTo(map);
  }

  // Fewer markers when zoomed out, more detail when zoomed in. Runs on moveend only (not every
  // frame): greedy by category priority, the selected place and route start always show.
  let mapReady = false;
  function layoutMarkers() {
    if (!map || !mapReady) return; // before the map's first load, pins would sit against an unsettled camera
    const z = map.getZoom();
    document.body.classList.toggle('compact-pins', z < 16.6);
    document.body.classList.toggle('show-courts', z >= 18);
    const gap = z < 16 ? 30 : z < 17 ? 26 : 22;
    const W = innerWidth, H = innerHeight;
    const dots: [number, number][] = [];
    const keyDots: [number, number][] = []; // dots that labels must avoid (faded context pins don't count)
    const labels: [number, number, number, number][] = [];
    const isSel = (m: M) => m.p.id === current?.id || m.p.id === routeFrom?.id;
    // college names take the space they need on the overview; pins underneath step aside
    // (not while a category is chosen: then the places matter, not the college names)
    const showAreas = z < AREA_Z && !narrowed();
    const areaBoxes: [number, number, number, number][] = [];
    // a name near the screen's edge slides in to stay whole, clear of the map controls
    const ctl = $('.controls').getBoundingClientRect();
    for (const a of areas) {
      a.el.classList.toggle('hidden', !showAreas);
      a.el.tabIndex = showAreas ? 0 : -1;
      if (!showAreas) continue;
      const pt = map.project(a.c), w = a.el.offsetWidth / 2 + 8;
      const right = ctl.width && pt.y > ctl.top - 24 && pt.y < ctl.bottom + 24 ? ctl.left - 4 : W - 8;
      const dx = Math.round(pt.x + w > right ? right - (pt.x + w) : pt.x - w < 8 ? 8 - (pt.x - w) : 0);
      a.marker.setOffset([dx, 0]);
      areaBoxes.push([pt.x + dx - w, pt.y - 24, pt.x + dx + w, pt.y + 24]);
    }
    // outside the chosen category (entrances, car parks and open-air spots have no chip and always show)
    // (entrances always stay, as small gates; open-air spots and car parks used to as well, now only under All)
    const off = (m: M) => m.group !== 'entrance' && !passes(m.p);
    const narrow = narrowed();
    const list = [...markers.values()].sort((a, b) => Number(isSel(b)) - Number(isSel(a)) || Number(off(a)) - Number(off(b)) || PRIORITY[b.group] - PRIORITY[a.group]);
    const shown: { m: M; x: number; y: number; sel: boolean }[] = [];
    // gate pins float just above the pillars' lanterns (about 5.4 m up, as seen at this zoom and tilt)
    const pxPerM = (512 * 2 ** z) / (40075017 * Math.cos((map.getCenter().lat * Math.PI) / 180));
    const lift = -Math.min(90, 5.4 * pxPerM * Math.sin((map.getPitch() * Math.PI) / 180) + 16);
    for (const m of list) {
      if (m.gate && m.offset[1] !== Math.round(lift)) { m.offset = [0, Math.round(lift)]; m.marker.setOffset(m.offset); }
      const sel = isSel(m);
      const filtered = off(m);
      // gates and off-campus context (bus stops, a shop) wait until you zoom in, unless Nearby is chosen
      const tooFar = (m.group === 'entrance' || (m.group === 'nearby' && filter !== 'nearby')) && z < 16.3;
      // places outside the chosen category stay as faint context once you're zoomed in; matches always come first
      let show = sel || (!tooFar && (!filtered || z >= 16.6));
      m.el.classList.toggle('faded', filtered && !sel);
      const pt = map.project(m.at);
      const x = pt.x + m.offset[0], y = pt.y + m.offset[1];
      const onScreen = x > -40 && x < W + 40 && y > -40 && y < H + 40;
      // with a category chosen, a match that collides shrinks instead of disappearing
      let mini = false;
      const squeezed = (show && onScreen && !sel && dots.some(([a, b]) => Math.hypot(a - x, b - y) < gap))
        || (show && !sel && areaBoxes.some(([a, b, c, d]) => x > a && x < c && y > b && y < d));
      if (squeezed) { if (narrow && !filtered && m.group !== 'entrance') mini = true; else show = false; }
      m.el.classList.toggle('mini', mini);
      m.el.classList.toggle('hidden', !show);
      m.el.tabIndex = show ? 0 : -1;
      m.el.classList.remove('show-label');
      if (show && onScreen) { dots.push([x, y]); if ((!filtered || sel) && !mini) { shown.push({ m, x, y, sel }); keyDots.push([x, y]); } }
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
  map?.once('load', () => { mapReady = true; layoutMarkers(); });
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
      new Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' }).setLngLat(p.c).addTo(map!);
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
    $('#open-now').hidden = !openApplies();
    if (!openApplies()) setOpenOnly(false);
    const chip = chipOf(f);
    $$('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === chip)));
    $(`.chip[data-filter="${chip}"]`).scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: ms(1) ? 'smooth' : 'auto' });
    layoutMarkers();
    updateFilterStatus();
    if (!$('#list').hidden) renderList();
    if (input.value) showResults();
    fitMatches();
  }
  /** "10 places" / "3 open now" beside the chips while a category is chosen */
  function updateFilterStatus() {
    const n = places.filter((p) => groupOf(p) !== 'entrance' && passes(p)).length;
    $('#filter-bar').hidden = !narrowed();
    $('#filter-status').textContent = !narrowed() ? '' : openOnly && openApplies() ? `${n} open now` : plural(n, 'place');
    $('#toast').hidden = true; // an old message about the previous filter
    const empty = $('#open-empty');
    empty.hidden = !(openOnly && openApplies() && n === 0);
    empty.innerHTML = empty.hidden ? '' : openNowEmpty();
  }
  /** Open now found nothing: what opens next, and the ways back */
  function openNowEmpty(): string {
    const pool = places.filter((p) => groupOf(p) !== 'entrance' && inFilter(p));
    const next = pool.map((p) => { const h = resolveHours(p.id); const st = h && openState(h); return { p, st }; })
      .filter((x): x is { p: Place; st: Extract<OpenState, { kind: 'closed' }> } => x.st?.kind === 'closed' && x.st.inMin != null)
      .sort((a, b) => a.st.inMin! - b.st.inMin!).slice(0, 3);
    const unknown = pool.filter((p) => { const h = resolveHours(p.id); return !h || ['unknown', 'stale'].includes(openState(h).kind); }).length;
    const label = chipOf(filter) === 'food' ? 'food places' : 'study places';
    return `<p><b>Nothing here is open right now.</b>${unknown ? ` ${plural(unknown, 'place has', 'places have')} no listed hours, so ${unknown === 1 ? 'it' : 'they'} can't show as open.` : ''}</p>
      ${next.length ? `<p class="next-head">Next to open</p><ul class="next-open">${next.map(({ p, st }) => `<li><button type="button" data-next="${p.id}"><b>${esc(p.name)}</b><span>opens ${esc(st.opens!)}</span></button></li>`).join('')}</ul>` : ''}
      <div class="empty-actions"><button type="button" class="btn ghost show-all-open">Show all ${label}</button><button type="button" class="btn ghost clear-all">Clear filters</button></div>`;
  }
  $('#open-empty').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const next = t.closest<HTMLElement>('[data-next]');
    if (next) { const p = byId.get(next.dataset.next!); if (p) select(p, { source: 'list' }); return; }
    if (t.closest('.show-all-open')) { setOpenOnly(false); layoutMarkers(); updateFilterStatus(); fitMatches(); if (!$('#list').hidden) renderList(); }
    if (t.closest('.clear-all')) clearFilters();
  });
  /** after a category change: frame its places (all of them, clear of the search bar and panel) */
  function fitMatches() {
    if (!map || navigating || filter === 'all') return;
    const pts = places.filter((p) => groupOf(p) !== 'entrance' && passes(p)).map((p) => markers.get(p.id)!.at);
    if (pts.length) fitPoints(pts, { maxZoom: 17.6, side: 36, duration: 500 });
  }
  const openToggle = $('#open-toggle');
  function setOpenOnly(on: boolean) {
    openOnly = on;
    openToggle.setAttribute('aria-checked', String(on));
  }
  openToggle.addEventListener('click', () => {
    setOpenOnly(!openOnly);
    layoutMarkers();
    updateFilterStatus();
    if (places.some((p) => groupOf(p) !== 'entrance' && passes(p))) fitMatches();
    if (!$('#list').hidden) renderList();
    if (input.value) showResults();
  });
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
  // Zoom about the middle of the part of the map you can see (not the screen's centre, which on a
  // phone sits behind the card), so the place you're looking at stays in view.
  const zoomInBtn = $<HTMLButtonElement>('#zoom-in'), zoomOutBtn = $<HTMLButtonElement>('#zoom-out');
  const zoomBy = (dz: number) => {
    if (!map) return;
    const a = freeArea();
    const around = map.unproject([(a.left + Math.min(a.right, innerWidth)) / 2, (a.top + a.bottom) / 2]);
    const target = Math.max(lowestZoom(), Math.min(map.getMaxZoom(), map.getZoom() + dz));
    camMove({ zoom: target, around, ...(flat || pitchedByHand ? {} : { pitch: autoPitch(target) }), duration: ms(250) });
  };
  zoomInBtn.addEventListener('click', () => zoomBy(1));
  zoomOutBtn.addEventListener('click', () => zoomBy(-1));
  /**
   * How far out the camera can go: minZoom, or less far when the screen would show more than the
   * map's maxBounds (MapLibre stops there). Same sum as MapLibre's: the bounds' Web Mercator width
   * and height against the canvas, in 512 px tiles.
   */
  function lowestZoom(): number {
    if (!map) return 0;
    const b = map.getMaxBounds();
    if (!b) return map.getMinZoom();
    const mx = (lng: number) => (lng + 180) / 360;
    const my = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
    const c = map.getCanvas();
    const need = Math.max(c.clientWidth / ((mx(b.getEast()) - mx(b.getWest())) * 512), c.clientHeight / ((my(b.getSouth()) - my(b.getNorth())) * 512));
    return Math.max(map.getMinZoom(), Math.log2(need));
  }
  /** + and − turn off at the limits (and say so to screen readers) */
  let zoomRaf = 0;
  function updateZoomButtons() {
    cancelAnimationFrame(zoomRaf);
    zoomRaf = requestAnimationFrame(() => {
      if (!map) return;
      const z = map.getZoom();
      const set = (b: HTMLButtonElement, off: boolean) => { if (b.disabled !== off) { b.disabled = off; b.setAttribute('aria-disabled', String(off)); } };
      set(zoomInBtn, z >= map.getMaxZoom() - 0.02);
      set(zoomOutBtn, z <= lowestZoom() + 0.02);
    });
  }
  map?.on('zoom', updateZoomButtons);
  map?.on('resize', updateZoomButtons);
  map?.once('load', updateZoomButtons);
  let flat = false; // 2D: looking straight down
  const tilt = (pitch: number) => (flat ? 0 : pitch);
  /**
   * Like Apple Maps, the view tilts a little more as you zoom in and flattens as you zoom out: 42°
   * at the widest, the home view's 50° at street level, 60° close up. It settles after a pinch or
   * scroll (never during one, which would fight the gesture), and stops once you tilt by hand
   * (two fingers up or down) until the compass, the 2D/3D button or the home view resets it.
   */
  const autoPitch = (z: number) => (z <= 14.5 ? 42 : z <= 16.2 ? 42 + ((z - 14.5) / 1.7) * 8 : Math.min(60, 50 + ((z - 16.2) / 2.3) * 10));
  let pitchedByHand = false;
  let gestureZoom = false;
  map?.on('pitchstart', (e) => { if ((e as { originalEvent?: Event }).originalEvent) pitchedByHand = true; });
  map?.on('zoomstart', (e) => { if ((e as { originalEvent?: Event }).originalEvent) gestureZoom = true; });
  // after the whole move has ended (a pinch can end in MapLibre's snap back to north, which would cut a tilt short)
  map?.on('moveend', () => {
    if (map?.isMoving()) return;
    const byGesture = gestureZoom;
    gestureZoom = false;
    if (!map || !byGesture || flat || pitchedByHand || Date.now() < camBusyUntil) return;
    const want = autoPitch(map.getZoom());
    if (Math.abs(map.getPitch() - want) > 1.5) map.easeTo({ pitch: want, duration: ms(350) });
  });
  $('#north').addEventListener('click', () => { pitchedByHand = false; camMove({ bearing: 0, pitch: tilt(autoPitch(map?.getZoom() ?? 16)), duration: ms(400) }); });
  $('#whole').addEventListener('click', () => showWholeCampus());
  const dimBtn = $('#dim');
  dimBtn.addEventListener('click', () => {
    flat = !flat;
    pitchedByHand = false;
    camMove({ pitch: tilt(autoPitch(map?.getZoom() ?? 16)), duration: ms(450) });
    dimBtn.textContent = flat ? '2D' : '3D';
    dimBtn.setAttribute('aria-pressed', String(!flat));
    dimBtn.setAttribute('aria-label', flat ? 'Switch to a 3D map' : 'Switch to a flat 2D map');
  });
  /**
   * Where the home view may draw: clear of everything floating over the map. Desktop: the search
   * column (and the welcome card under it) on the left, the controls on the right. Phone: the
   * search and chips on top, the welcome card (or the Key and Find me row) at the bottom.
   */
  function homeBox(W: number, H: number) {
    const r = (el: HTMLElement) => (el.hidden ? null : el.getBoundingClientRect());
    const hello = r(welcome);
    // pins stand about 40 px above their point; a little air on every side
    if (isDesktop()) {
      const left = Math.max($('.top').getBoundingClientRect().right, hello?.right ?? 0) + 24;
      const right = Math.min(...[$('.controls'), keyBtn].map(r).filter((x) => x?.width).map((x) => x!.left)) - 24;
      return { l: left, r: Math.min(right, W - 24), t: 48, b: H - 20 };
    }
    const keyRow = r(keyBtn);
    const bottom = hello ? hello.top : keyRow?.width ? keyRow.top : H;
    // 24 px: a pin's touch target reaches 22 px either side of its point. The map controls stand
    // down the right side: the campus keeps clear of them (only where they are, below their top)
    const ctl = r($('.controls'));
    const right = ctl?.width && ctl.top < bottom ? Math.min(W - 24, ctl.left - 6) : W - 24;
    return { l: 16, r: right, t: $('#chips').getBoundingClientRect().bottom + 30, b: Math.min(bottom, H) - 10 };
  }
  // The home view is worked out once per screen size and then reused, so the ⛶ button brings back
  // exactly the opening view (closing the welcome card doesn't move the map either).
  let home: { size: string; center: MLLngLat; zoom: number } | null = null;
  function showWholeCampus(duration = 500) {
    if (!map) return;
    pitchedByHand = false;
    const W = map.getCanvas().clientWidth, H = map.getCanvas().clientHeight;
    const size = `${W}x${H}`;
    if (home?.size === size) {
      setFollowing(false);
      camMove({ center: home.center, zoom: home.zoom, pitch: tilt(HOME.pitch), bearing: HOME.bearing, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: ms(duration) });
      return;
    }
    const end = fitPoints(campusPoints, { pitch: tilt(HOME.pitch), bearing: HOME.bearing, maxZoom: 17.5, box: homeBox(W, H), duration });
    if (end && !flat) home = { size, center: end.center, zoom: end.zoom };
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
  const avatar = new Marker({ element: avatarEl, anchor: 'bottom', offset: [0, 2] });

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
        const walk = navId;
        setTimeout(() => { if (navigating && navId === walk) endNavigation(); }, 4000);
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
      lastLocateError = null;
      showFix(fix);
      startTracking();
      pendingLocate?.(true);
    } catch (err) {
      lastLocateError = (err as GeolocationPositionError).code ?? 2;
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
    if (!$('#list').hidden) renderList(); // distances, and Nearest, now that we know where you are
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
      // a search result or list row is gone once picked: then focus goes back to the search box
      const a = document.activeElement as HTMLElement;
      panelOpener = a?.closest('#results, #list') ? (a.closest('#results') || !map ? input : listBtn) : a;
      panel.hidden = false;
      void panel.offsetHeight; // start the transition from the closed position
    }
    panel.classList.add('open');
    document.body.classList.add('panel-open');
  }
  function closePanel() {
    leaveNavMode();
    current = null;
    currentRoom = null;
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
  function fitPoints(points: LngLat[], opts: { pitch?: number; bearing?: number; maxZoom?: number; box?: { l: number; r: number; t: number; b: number }; duration?: number; side?: number } = {}) {
    if (!map || !points.length) return null;
    const W = map.getCanvas().clientWidth, H = map.getCanvas().clientHeight;
    const a = freeArea();
    // pins stand about 20 px either side of their point and 40 px above it
    const side = opts.side ?? 20; // pins stand about 20 px either side of their point; their names reach further
    const box = opts.box ?? { l: a.left + side, r: Math.min(a.right, W) - side, t: a.top + 30, b: Math.min(a.bottom, H) - 8 };
    const zero = { top: 0, bottom: 0, left: 0, right: 0 };
    const before = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding() };
    const b = new mapMod!.maplibregl.LngLatBounds(points[0], points[0]);
    for (const p of points) b.extend(p);
    map.jumpTo({ center: b.getCenter(), zoom: opts.maxZoom ?? 18, pitch: opts.pitch ?? map.getPitch(), bearing: opts.bearing ?? map.getBearing(), padding: zero });
    /** centre the points in the box at this zoom (a few steps: the tilt skews it); true if they fit */
    const fitsAt = (zoom: number) => {
      map!.jumpTo({ zoom });
      let fits = false;
      for (let i = 0; i < 8; i++) {
        const xy = points.map((p) => map!.project(p));
        const xs = xy.map((q) => q.x), ys = xy.map((q) => q.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const dx = (minX + maxX) / 2 - (box.l + box.r) / 2, dy = (minY + maxY) / 2 - (box.t + box.b) / 2;
        fits = maxX - minX <= box.r - box.l && maxY - minY <= box.b - box.t;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
        map!.jumpTo({ center: map!.unproject([W / 2 + dx, H / 2 + dy]) });
      }
      // the camera may not reach the centre (it's kept near campus): then check where the points
      // really landed, so a point never ends up off the screen
      const xy = points.map((p) => map!.project(p));
      return fits && xy.every((q) => q.x >= box.l - 2 && q.x <= box.r + 2 && q.y >= box.t - 2 && q.y <= box.b + 2);
    };
    // the closest zoom that still fits, to about 1%
    let lo = map.getMinZoom(), hi = opts.maxZoom ?? 18;
    if (!fitsAt(hi)) {
      while (hi - lo > 0.01) { const mid = (lo + hi) / 2; if (fitsAt(mid)) lo = mid; else hi = mid; }
      fitsAt(lo);
    }
    const after = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    map.jumpTo(before);
    setFollowing(false); // the view goes somewhere else; the locate button follows you again
    camMove({ ...after, padding: zero, duration: ms(opts.duration ?? 600) });
    return after;
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
    setFollowing(false);
    camFly({
      center: p.position, zoom,
      padding: pad(a.top, a.mapH - a.bottom, a.left, innerWidth - a.right),
      duration: ms(1000),
    });
  }

  const HOURS_MATTER = new Set<GroupId>(['food', 'library', 'sport', 'services']);
  /** open or closed now, and where the hours come from (src/data/hours.ts). Nothing at all without hours. */
  function hoursBlock(p: Place): string {
    const h = resolveHours(p.id);
    // where opening times matter, say plainly that we don't know them (never "closed")
    if (!h) return HOURS_MATTER.has(groupOf(p)) ? `<div class="hours-wrap"><div class="hours"><span class="badge unknown">Hours not listed</span></div>
      <p class="hours-src">We haven't found verified hours yet.${p.officialUrl ? ' Check the official page before you go.' : ''}</p></div>` : '';
    const s = openState(h);
    const [cls, text] =
      s.kind === 'open' ? (s.closes === null ? ['open', 'Open 24 hours'] : [s.soon ? 'soon' : 'open', `${s.soon ? 'Closing soon' : 'Open now'} · closes ${s.closes}`])
      : s.kind === 'closed' ? ['closed', s.opens ? `Closed · opens ${s.opens}` : 'Closed']
      : s.kind === 'stale' ? ['unknown', 'Hours may have changed']
      : ['unknown', h.unknown ?? "Today's hours not listed"];
    const src = !h.source ? '' : h.source.url
      ? ` · Source: <a href="${esc(h.source.url)}" target="_blank" rel="noopener">${esc(h.source.name)}</a>`
      : ` · Source: ${esc(h.source.name)}`;
    return `<div class="hours-wrap"><div class="hours"><span class="badge ${cls}">${esc(text)}</span></div>
      ${h.serving ? `<p class="hours-serving">${esc(h.serving)}</p>` : ''}
      <p class="hours-src">Hours checked ${fmtDate(h.checked)}${src}</p></div>`;
  }
  /** the coming week, under "View details" (not for hours that may have changed, or none listed at all) */
  function weekBlock(p: Place): string {
    const h = resolveHours(p.id);
    if (!h || h.stale || !weekRows(h).some(([, t]) => t !== (h.unknown ?? 'Not listed'))) return '';
    return `<div class="week-wrap"><table class="week" aria-label="Opening hours this week">${weekRows(h).map(([d, t], i) => `<tr${i ? '' : ' class="is-today"'}><th scope="row">${d}</th><td>${t}</td></tr>`).join('')}</table>
      ${h.notes ? `<p class="notes">${esc(h.notes)}</p>` : ''}</div>`;
  }
  /** new live hours, or a minute gone by: update the open card and the "Open now" filter in place */
  function refreshHours() {
    const wrap = panelBody.querySelector('.hours-wrap');
    if (current && wrap) {
      wrap.outerHTML = hoursBlock(current) || '<div class="hours-wrap" hidden></div>';
      const week = panelBody.querySelector('.week-wrap');
      if (week) week.outerHTML = weekBlock(current) || '<div class="week-wrap" hidden></div>';
    }
    if (openOnly && openApplies()) { layoutMarkers(); updateFilterStatus(); if (!$('#list').hidden) renderList(); }
  }
  setInterval(() => { if (!document.hidden) refreshHours(); }, 60000);
  const fetchLive = () => refreshLiveHours().then((changed) => changed && refreshHours());
  fetchLive();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchLive(); });

  /** "About 4 min walk from you", only from a fresh, decent fix on campus and a real path route. */
  function walkHint(p: Place): string {
    if (!fix || stale || fix.accuracy > config.weakGpsM || distanceToBounds(fix.pos, doc.bounds) > 0) return '';
    const r = router.route(fix.pos, routeTarget(p), footprints);
    return r ? `About ${r.minutes} min walk from you` : '';
  }

  /** the building's doors as far as they are known; says so plainly when they aren't */
  function entranceInfo(p: Place): string {
    const TYPE = { main: 'Main entrance', accessible: 'Step-free entrance', 'card-required': 'Card access', closed: 'Closed entrance' } as const;
    const doors = [...(p.entrances ?? [])];
    if (!doors.length) return p.footprintId && p.category !== 'entrance' ? '<p class="small entrances">Entrances: not verified yet. Directions end on the path nearest the building.</p>' : '';
    return `<ul class="entrances small">${doors.map((d) => `<li>${TYPE[d.type]}${d.name ? `: ${esc(d.name)}` : ''} · ${d.verified ? `checked${d.checked ? ` ${fmtDate(d.checked)}` : ''}` : 'not verified'}</li>`).join('')}</ul>`;
  }

  /** a bus stop: which way its buses go, which routes stop there, and TfL's page for live times */
  function busBlock(p: Place): string {
    const b = p.bus;
    if (!b) return '';
    return `<div class="bus-info">
        <p class="bus-dir"><b>${esc(b.direction[0].toUpperCase() + b.direction.slice(1))}bound</b> · towards ${esc(b.towards)}</p>
        <ul class="bus-routes" aria-label="Bus routes">${b.routes.map((r) => `<li${/^N/.test(r) ? ' class="night" title="Night bus"' : ''}>${esc(r)}</li>`).join('')}</ul>
        <a class="btn ghost tfl" href="https://tfl.gov.uk/bus/stop/${encodeURIComponent(b.atco)}/" target="_blank" rel="noopener">${icons.bus}<span>Live times on TfL</span>${icons.external}</a>
        <p class="small">Routes and direction from TfL, checked ${fmtDate(b.checked)}. Night buses start with N.</p>
      </div>`;
  }
  function renderCard(p: Place, expanded = false) {
    const g = groupOf(p);
    const placeLabel = (p.code ? `${p.name} (${p.code})` : p.name) + (currentRoom ? `, room ${currentRoom}` : '');
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
          <p class="meta">${[p.code && `<span class="code">${esc(p.code)}</span>`, esc(groupLabel(g)), p.college && COLLEGE[p.college], p.offCampus && '<span class="off-campus">Off campus</span>'].filter(Boolean).join(' · ')}</p>
        </div>
        <button class="icon-btn save" aria-pressed="${saved.has(p.id)}" aria-label="Save ${esc(p.name)}">${icons.bookmark}</button>
        <button class="icon-btn close" aria-label="Close">${icons.close}</button>
      </div>
      ${roomBlock(p)}
      ${p.description ? `<p class="desc${expanded ? '' : ' clamp'}">${esc(p.description)}</p>` : ''}
      ${hoursBlock(p) || '<div class="hours-wrap" hidden></div>'}
      ${busBlock(p)}
      ${walk ? `<p class="walk-hint">${icons.walk}<span>${walk}</span></p>` : ''}
      <div class="actions">
        <button class="btn primary dir">${icons.directions}<span>Take me there</span></button>
        <button class="btn ghost more-info" aria-expanded="${expanded}" aria-controls="details">${expanded ? 'Hide details' : 'View details'}</button>
      </div>
      <div id="details" class="details"${expanded ? '' : ' hidden'}>
        ${p.photo ? `<img class="photo" src="/${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy" decoding="async" width="1200" height="675">` : ''}
        ${p.services?.length ? `<ul class="services" aria-label="Services">${p.services.map((s, i) => `<li${i >= 4 ? ' hidden' : ''}>${esc(s)}</li>`).join('')}${p.services.length > 4 ? `<li><button class="more" aria-label="Show ${p.services.length - 4} more services">+${p.services.length - 4} more</button></li>` : ''}</ul>` : ''}
        ${p.tags?.length ? `<p class="facilities"><b>Also here:</b> ${p.tags.map(esc).join(' · ')}</p>` : ''}
        ${weekBlock(p) || '<div class="week-wrap" hidden></div>'}
        ${p.accessibility ? `<p class="access"><a href="${esc(p.accessibility.url)}" target="_blank" rel="noopener">${icons.accessible}<span>${esc(p.accessibility.summary)}</span></a></p>` : ''}
        ${entranceInfo(p)}
        <div class="detail-links">
          <button class="btn ghost share" aria-label="Share a link to ${esc(p.name)}">${icons.share}<span>Share</span></button>
          ${p.officialUrl ? `<a class="official" href="${esc(p.officialUrl)}" target="_blank" rel="noopener">Official page ${icons.external}</a>` : ''}
        </div>
        <p class="small">${[
          src ? `Info checked${checked ? ` ${fmtDate(checked)}` : ''} · Source: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.title)}</a>` : checked ? `Info checked ${fmtDate(checked)}` : '',
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
    if (on) panel.classList.remove('route-peek');
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
    if (panel.classList.contains('route-peek')) panel.classList.remove('route-peek'); // the steps, full height
    else if (panelBody.querySelector('#details')) setExpanded(!panel.classList.contains('expanded'));
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
      if (dy < -40 && panel.classList.contains('route-peek')) panel.classList.remove('route-peek');
      else if (dy < -40 && hasDetails) setExpanded(true);
      else if (dy > 70) { if (panel.classList.contains('expanded')) setExpanded(false); else closePanel(); }
    });
  }
  // the desktop side card and list start just under the search + chips block, whatever its height
  // (measured at the chips; while search suggestions hide them the last value stays)
  const topObserver = new ResizeObserver(() => {
    const r = $('#chips').getBoundingClientRect();
    const o = $('#filter-bar').getBoundingClientRect();
    if (r.height) document.documentElement.style.setProperty('--top-b', `${Math.round(Math.max(r.bottom, o.bottom))}px`);
  });
  topObserver.observe($('#chips'));
  topObserver.observe($('#filter-bar'));
  // keep the floating controls above the sheet on phones
  new ResizeObserver(() => {
    const h = panel.hidden ? 0 : panel.offsetHeight;
    document.documentElement.style.setProperty('--sheet-h', `${h}px`);
    document.body.classList.toggle('sheet-tall', h > innerHeight * 0.55);
    fitControls();
    setTimeout(() => { fitControls(); layoutMarkers(); }, 220); // after the controls have slid
  }).observe(panel);
  /**
   * Phones: above a card or the list there may not be room for every control. Keep as many as fit
   * between the chips and the sheet, most useful first: zoom in and out, find me, north, whole
   * campus, 2D/3D. With no room even for the zoom pair, the controls fade out.
   */
  function fitControls() {
    const ctls = $('.controls');
    const all = ['zoom-in', 'zoom-out', 'findme', 'north', 'whole', 'dim'].map((id) => document.getElementById(id)!);
    all.forEach((b) => b.classList.remove('ctl-off'));
    ctls.classList.remove('no-room');
    if (isDesktop() || document.body.classList.contains('no-map')) return;
    const bottom = innerHeight - parseFloat(getComputedStyle(ctls).bottom);
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-b')) || 160;
    const fit = Math.floor((bottom - top - 8 + 6) / 50);
    if (fit < 2) { ctls.classList.add('no-room'); return; }
    all.slice(fit).forEach((b) => b.classList.add('ctl-off'));
  }
  addEventListener('resize', fitControls);

  // the selected place's door, when its entrance has been mapped
  const doorEl = document.createElement('div');
  doorEl.className = 'door-pin';
  doorEl.setAttribute('aria-hidden', 'true');
  doorEl.innerHTML = icons.entrance;
  const doorMarker = new Marker({ element: doorEl, anchor: 'bottom' });
  const showDoor = (p: Place | null) => { if (map && p?.entrance) doorMarker.setLngLat(p.entrance).addTo(map); else doorMarker.remove(); };

  /** ?place=…, plus &room=… when a room was searched for */
  const placeQuery = (p: Place) => `?place=${encodeURIComponent(p.id)}${currentRoom && current?.id === p.id ? `&room=${encodeURIComponent(currentRoom)}` : ''}`;
  /** "Ma101, Mandela Building" or just the building */
  const destName = (p: Place) => (currentRoom && current?.id === p.id ? `${currentRoom}, ${p.name}` : p.name);
  /** the same inside a sentence: "the Library", "Ma101, Mandela Building" */
  const destInText = (p: Place) => (currentRoom && current?.id === p.id ? destName(p) : theName(p.name));
  /** what we know about the searched room: the building always, the inside only from checked data */
  function roomBlock(p: Place): string {
    if (!currentRoom) return '';
    const r = p.rooms?.[currentRoom];
    if (r) {
      return `<div class="room-line"><b>Room ${esc(currentRoom)}</b>${[r.floor && `Floor: ${esc(r.floor)}`, r.entrance && `Way in: ${esc(r.entrance)}`, r.note && esc(r.note)].filter(Boolean).map((x) => `<span>${x}</span>`).join('')}
        <small>Checked ${fmtDate(r.checked)} · ${esc(r.source)}</small></div>`;
    }
    return `<div class="room-line"><b>Room ${esc(currentRoom)}</b><span>Building found from the room code. The room's floor and way in aren't verified yet: follow the signs inside, or ask at reception.</span></div>`;
  }
  function select(p: Place, opts: { source: 'marker' | 'building' | 'search' | 'link' | 'list'; room?: string }) {
    if (!welcome.hidden) dismissWelcome();
    if (navigating && p.id === current?.id) return; // your own destination: keep walking
    if (navigating) { leaveNavMode(); clearRoute(); }
    if (current?.id !== p.id) clearRoute();
    // a room stays with its building; picking any other way starts afresh
    currentRoom = opts.room ?? (current?.id === p.id && (opts.source === 'marker' || opts.source === 'building') ? currentRoom : null);
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
    history.replaceState(null, '', placeQuery(p));
    track('place-tap', { id: p.id, via: opts.source });
    const far = opts.source !== 'marker' && opts.source !== 'building';
    requestAnimationFrame(() => { ensureVisible(p, far); layoutMarkers(); });
    if (far) $('#panel-name').focus({ preventScroll: true });
  }

  async function share(p: Place) {
    const url = `${location.origin}/${placeQuery(p)}`;
    if (navigator.share) {
      try { await navigator.share({ title: `${destName(p)} · Roam`, text: currentRoom ? `Room ${currentRoom} is in the ${p.name}, on the Roehampton campus map` : `${p.name} on the Roehampton campus map`, url }); } catch { /* cancelled */ }
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
  const startMarker = new Marker({ element: pinEl('start', 'A') });
  const endMarker = new Marker({ element: pinEl('end', 'B') });
  let fromValue = '';

  // Where a walk starts: 'me', a place id, or 'pt:lng,lat' (a spot picked on the map)
  let pickingStart = false;
  const recentFrom = (): string[] => { try { return (JSON.parse(store.get('roam.recentFrom') ?? '[]') as string[]).filter((id) => id === 'me' || byId.has(id)); } catch { return []; } };
  const rememberFrom = (v: string) => { if (v && !v.startsWith('pt:')) store.set('roam.recentFrom', JSON.stringify([v, ...recentFrom().filter((x) => x !== v)].slice(0, 5))); };
  const pointOf = (v: string): LngLat | null => { const m = /^pt:(-?[\d.]+),(-?[\d.]+)$/.exec(v); return m ? [Number(m[1]), Number(m[2])] : null; };
  const fromLabel = (v: string) => (v === 'me' ? 'My location' : pointOf(v) ? 'Spot picked on the map' : byId.get(v)?.name ?? '');
  /** a place that has others inside it (the Library Café in the Library) reads "Library Café, in Library" */
  type FromOpt = { value: string; label: string; hint?: string; icon: string };
  function fromOptions(q: string, dest: Place): { head?: string; opts: FromOpt[] }[] {
    const placeOpt = (p: Place): FromOpt => ({ value: p.id, label: p.name, hint: p.code || undefined, icon: groupOf(p) === 'entrance' ? icons.entrance : placeIcon(p.category, p.kind) });
    const me: FromOpt = { value: 'me', label: 'My location', hint: fix ? undefined : 'asks to use your location', icon: icons.locate };
    const pick: FromOpt = { value: 'pick', label: 'Pick on the map', hint: 'tap where you are', icon: icons.map };
    const others = places.filter((x) => x.id !== dest.id);
    if (q.trim()) {
      const hits = search(q, others, 8).map((h) => placeOpt(h.place));
      const extra = /^(my|me|loc|here|gps)/i.test(q.trim()) ? [me] : [];
      return [{ opts: [...extra, ...hits] }];
    }
    const recent = recentFrom().filter((v) => v !== 'me' && v !== dest.id).map((v) => placeOpt(byId.get(v)!));
    return [
      { opts: [me, ...(map ? [pick] : [])] },
      ...(recent.length ? [{ head: 'Recent', opts: recent }] : []),
      { head: 'Campus entrances', opts: others.filter((x) => x.category === 'entrance').map(placeOpt) },
      { head: 'All places', opts: others.filter((x) => x.category !== 'entrance').sort((a, b) => a.name.localeCompare(b.name)).map(placeOpt) },
    ];
  }

  function openDirections(p: Place) {
    directionsOpen = true;
    pickingStart = false;
    setExpanded(false); // keep the map visible above the directions
    if (fromValue === p.id) fromValue = '';
    if (!fromValue && fix && distanceToBounds(fix.pos, doc.bounds) === 0) fromValue = 'me';
    panelBody.innerHTML = `
      <div class="p-head">
        <button class="icon-btn back" aria-label="Back to ${esc(p.name)}">${icons.back}</button>
        <div class="titles"><h2 id="panel-name" tabindex="-1">Directions</h2><p class="meta">to ${esc(destName(p))}</p></div>
        <button class="icon-btn close" aria-label="Close">${icons.close}</button>
      </div>
      <div class="field from-field">
        <label for="from-input">Starting from</label>
        <div class="from-row">
          <div class="combo">
            <input id="from-input" type="text" role="combobox" aria-expanded="false" aria-controls="from-list" aria-autocomplete="list"
              autocomplete="off" spellcheck="false" placeholder="Search: entrance, building or My location" />
            <ul id="from-list" class="from-list" role="listbox" aria-label="Starting points" hidden></ul>
          </div>
          <button type="button" class="icon-btn swap" aria-label="Swap start and destination" title="Swap start and destination">${icons.swap}</button>
        </div>
      </div>
      <div id="route-result" class="route-result" aria-live="polite"></div>`;
    const inp = panelBody.querySelector<HTMLInputElement>('#from-input')!;
    const list = panelBody.querySelector<HTMLElement>('#from-list')!;
    const swapBtn = panelBody.querySelector<HTMLButtonElement>('.swap')!;
    let flat: FromOpt[] = [];
    let active = -1;
    const syncSwap = () => {
      const ok = !!byId.get(fromValue);
      swapBtn.disabled = !ok;
      swapBtn.title = ok ? 'Swap start and destination' : 'Swap works when the start is a place';
    };
    inp.value = fromLabel(fromValue);
    syncSwap();
    const close = () => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); active = -1; };
    const highlight = (i: number) => {
      active = Math.max(0, Math.min(i, flat.length - 1));
      list.querySelectorAll('[role=option]').forEach((el, j) => el.setAttribute('aria-selected', String(j === active)));
      const el = list.querySelector<HTMLElement>(`#from-opt-${active}`);
      if (el) { inp.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    };
    const render = () => {
      const q = inp.value === fromLabel(fromValue) ? '' : inp.value; // showing the current choice: list everything
      const groups = fromOptions(q, p);
      flat = groups.flatMap((g) => g.opts);
      let i = 0;
      list.innerHTML = flat.length ? groups.filter((g) => g.opts.length).map((g) => (g.head ? `<li class="res-head" role="presentation">${esc(g.head)}</li>` : '')
        + g.opts.map((o) => `<li id="from-opt-${i}" role="option" aria-selected="false" data-i="${i++}"><span class="opt-icon">${o.icon}</span><span>${esc(o.label)}${o.hint ? ` <small>${esc(o.hint)}</small>` : ''}</span></li>`).join('')).join('')
        : '<li class="res-head" role="presentation">No starting point matches. Try an entrance or a building name.</li>';
      list.hidden = false;
      inp.setAttribute('aria-expanded', 'true');
      active = -1;
      if (!isDesktop()) panel.classList.add('expanded'); // room for the list on a phone
    };
    const choose = (o: FromOpt) => {
      close();
      setExpanded(false); // back down, so the route shows on the map
      if (o.value === 'pick') { startPicking(p); return; }
      fromValue = o.value;
      inp.value = fromLabel(fromValue);
      syncSwap();
      planRoute();
    };
    inp.addEventListener('focus', () => { inp.select(); render(); });
    inp.addEventListener('input', render);
    inp.addEventListener('blur', () => setTimeout(() => { if (!list.contains(document.activeElement)) { close(); inp.value = fromLabel(fromValue); } }, 150));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); highlight(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); const o = flat[active >= 0 ? active : 0]; if (o && !list.hidden) choose(o); }
      else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); inp.value = fromLabel(fromValue); }
    });
    // pointerdown, not click: picking happens before the input's blur closes the list
    list.addEventListener('pointerdown', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!li) return;
      e.preventDefault();
      choose(flat[Number(li.dataset.i)]);
    });
    swapBtn.addEventListener('click', () => {
      const start = byId.get(fromValue);
      if (!start) return;
      const dest = p;
      fromValue = dest.id;
      select(start, { source: 'list' });
      openDirections(start);
    });
    panelBody.querySelector('.back')!.addEventListener('click', () => { pickingStart = false; clearRoute(); directionsOpen = false; renderCard(p); $('#panel-name').focus(); layoutMarkers(); });
    panelBody.querySelector('.close')!.addEventListener('click', closePanel);
    $('#panel-name').focus({ preventScroll: true });
    planRoute();
  }

  /** "Pick on the map": the next tap on the map is where the walk starts */
  function startPicking(p: Place) {
    pickingStart = true;
    clearRoute();
    const out = document.querySelector<HTMLElement>('#route-result');
    if (out) {
      out.innerHTML = `<p class="pick-note">${icons.locate}<span>Tap the map where you're starting.</span></p><button class="btn ghost cancel-pick">Cancel</button>`;
      out.querySelector('.cancel-pick')!.addEventListener('click', () => { pickingStart = false; if (current === p) openDirections(p); });
    }
    toast('Tap the map where you are starting', 4000);
  }

  /** a route can't start here: say why, and offer the main entrance in one tap */
  function offerGate(out: HTMLElement, msg: string) {
    const gate = byId.get('gate-main');
    out.innerHTML = `<p>${msg}</p>${gate && current?.id !== gate.id ? `<button class="btn ghost from-gate">${icons.entrance}<span>Start from the ${esc(gate.name)}</span></button>` : ''}`;
    out.querySelector('.from-gate')?.addEventListener('click', () => {
      fromValue = gate!.id;
      const inp = document.querySelector<HTMLInputElement>('#from-input');
      if (inp) inp.value = fromLabel(fromValue);
      planRoute();
    });
  }

  /** what we can honestly say about where the route ends */
  function endNote(r: Route, to: Place): string {
    if (r.endsAt === 'entrance-verified') return `Ends at the ${esc(r.door?.name ?? `${to.name} entrance`)}${r.door?.type === 'card-required' ? ' (needs a university card)' : r.door?.type === 'accessible' ? ' (step-free entrance)' : ''}.`;
    if (r.endsAt === 'entrance-unverified') return 'Ends at an entrance that hasn\'t been checked on site yet.';
    return to.footprintId ? 'Ends on the path nearest the building. Its entrances haven\'t been verified yet, so look for the door from there.' : 'Ends on the path nearest this spot.';
  }

  /** a mapped place standing right by a point on the route (for "Turn left by the Library") */
  function landmarkAt(pt: LngLat, skip: Set<string>): string | null {
    let best: { name: string; d: number } | null = null;
    for (const p of places) {
      if (skip.has(p.id) || p.category === 'entrance' || (p.footprintId && footprintToPlace.get(p.footprintId) !== p)) continue;
      const rings = p.footprintId ? outlines.get(p.footprintId) : null;
      const d = rings ? (rings.some((r) => touches(pt, r, 12)) ? 0 : Infinity) : distanceM(pt, p.position) <= 20 ? distanceM(pt, p.position) : Infinity;
      if (d < (best?.d ?? Infinity)) best = { name: theName(p.name), d };
    }
    return best?.name ?? null;
  }

  /** opening hours against the walk: "may close before you arrive", or closed now */
  function arrivalHours(p: Place, minutes: number): string {
    const h = resolveHours(p.id);
    if (!h) return '';
    const st = openState(h);
    if (st.kind === 'open' && st.leftMin != null && st.leftMin <= minutes + 5) return `<b>${esc(p.name)} closes at ${st.closes}: it may close before you arrive.</b>`;
    if (st.kind === 'closed') return `${esc(p.name)} is closed now${st.opens ? ` (opens ${st.opens})` : ''}.`;
    return '';
  }

  let lastLocateError: number | null = null; // 1 refused, 2 no fix, 3 timed out
  /** why there's no position, as the start of a sentence that ends "…choose a starting point above." */
  const noFixReason = () => lastLocateError === 1 ? 'Location is turned off for Roam in this browser. You can allow it in the browser\'s site settings, or'
    : lastLocateError === 2 || lastLocateError === 3 ? 'We couldn\'t get a GPS fix (indoors, or a weak signal). Try again outside, or'
    : 'Without your location,';
  async function planRoute() {
    const to = current;
    const out = document.querySelector<HTMLElement>('#route-result');
    if (!to || !out) return;
    pickingStart = false;
    clearRoute();
    if (!fromValue) {
      out.innerHTML = `<p>Choose where you're starting from, or use your location.</p>
        <button class="btn ghost use-me">${icons.locate}<span>Use my location</span></button>`;
      out.querySelector('.use-me')!.addEventListener('click', async () => {
        const ok = await requestLocation();
        if (current !== to || !out.isConnected) return;
        if (!ok) { offerGate(out, `${noFixReason()} choose a starting point above.`); return; }
        fromValue = 'me';
        const inp = document.querySelector<HTMLInputElement>('#from-input');
        if (inp) inp.value = fromLabel('me');
        planRoute();
      });
      return;
    }
    let from: LngLat | Place;
    let fromName: string | null = null;
    const picked = pointOf(fromValue);
    if (fromValue === 'me') {
      if (!fix && !(await requestLocation())) {
        if (!out.isConnected) return;
        offerGate(out, `${noFixReason()} choose a starting point above.`);
        return;
      }
      if (current !== to || !out.isConnected) return; // you moved on while the location prompt was up
      const f = fix!;
      const off = distanceToBounds(f.pos, doc.bounds);
      if (off > 0) {
        offerGate(out, `You're not on campus yet (${formatDistance(off)} away). Walking routes start on campus: choose an entrance as your starting point.`);
        return;
      }
      from = f.pos;
    } else if (picked) {
      if (distanceToBounds(picked, doc.bounds) > 0) { offerGate(out, 'That spot is outside the campus map. Pick a spot on campus, or start from an entrance.'); return; }
      from = picked;
      startMarker.setLngLat(picked);
    } else {
      const p = byId.get(fromValue);
      if (!p) return;
      routeFrom = p;
      from = p;
      fromName = theName(p.name);
    }
    // off campus (a hall down the road, a bus stop): the walking network stops at the campus wall
    // Off campus (a hall down the road, a bus stop): the walking network stops at the campus wall.
    // Right by a gate, the route goes to that gate and says how far the rest is; further away,
    // Roam says so and leaves that part to a street map.
    let rTo = to;
    let offNote = '';
    const offPlace = to.offCampus ? to : !Array.isArray(from) && from.offCampus ? from : null;
    if (offPlace) {
      const gates = places.filter((x) => x.category === 'entrance');
      const near = gates.reduce((a, b) => (distanceM(a.position, offPlace.position) <= distanceM(b.position, offPlace.position) ? a : b));
      const gap = distanceM(near.position, offPlace.position);
      if (gap > 200 || near.id === (Array.isArray(from) ? '' : from.id) || near.id === to.id) {
        offerGate(out, `${esc(offPlace.name)} is off campus, and Roam's walking routes only cover the campus. It's about ${formatDistance(gap)} in a straight line from ${esc(theName(near.name))}; use a street map for that part.`);
        return;
      }
      offNote = offPlace === to
        ? `The route ends at ${esc(theName(near.name))}. ${esc(to.name)} is off campus, about ${formatDistance(gap)} from there in a straight line.`
        : `${esc(offPlace.name)} is off campus: the route starts at ${esc(theName(near.name))}, about ${formatDistance(gap)} from it in a straight line.`;
      if (offPlace === to) rTo = near; else { from = near; routeFrom = near; fromName = theName(near.name); }
    }
    const r = router.route(Array.isArray(from) ? from : routeTarget(from), routeTarget(rTo), footprints);
    if (!r) {
      offerGate(out, 'We couldn\'t find a mapped walking route between these two places.');
      return;
    }
    rememberFrom(fromValue);
    if (!isDesktop()) { setExpanded(false); panel.classList.add('route-peek'); panel.scrollTop = 0; }
    drawRoute(r, from);
    lastRoute = r;
    const steps = routeSteps([...r.coordinates], {
      from: fromName ?? (picked ? 'the spot you picked' : null),
      startHopM: r.startHop.length === 2 ? distanceM(r.startHop[0], r.startHop[1]) : 0,
      dest: destInText(to),
      arrive: offNote && rTo !== to ? `Arrive at ${theName(rTo.name)}; ${to.name} is about ${formatDistance(distanceM(rTo.position, to.position))} away, off campus.` : r.endsAt === 'nearest-path' ? `You're by ${destInText(to)}. ${to.footprintId ? 'Its entrance isn\'t verified yet.' : ''}`.trim() : `Arrive at ${destInText(to)}.`,
      landmark: (pt) => landmarkAt(pt, new Set([to.id, routeFrom?.id ?? ''])),
    });
    const notes = [
      offNote || endNote(r, to),
      r.hasSteps ? 'Includes steps.' : '',
      fromValue === 'me' && fix && fix.accuracy > config.weakGpsM ? `Your location is approximate (about ${Math.round(fix.accuracy)} m).` : '',
      currentRoom ? `Room ${esc(currentRoom)}: inside the building, follow the signs (the room's floor isn't verified).` : '',
      arrivalHours(to, r.minutes),
    ].filter(Boolean);
    out.innerHTML = `<p class="route-sum">${icons.walk}<span><b>About ${r.minutes} min</b> · ${formatDistance(r.distanceM)} along paths</span></p>
      ${map ? `<div class="route-go"><button class="btn primary nav-start">${icons.directions}<span>Start</span></button></div>` : ''}
      <ul class="route-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      <details class="steps-wrap"${map ? '' : ' open'}><summary>Step by step (${steps.length})</summary>
        <ol class="steps">${steps.map((st) => `<li>${esc(st.text)}</li>`).join('')}</ol></details>
      <p class="small">Follows footpaths and campus roads mapped on OpenStreetMap. ${r.hasSteps ? 'Step-free routes' : 'No steps are mapped on this route, but step-free routes'} aren't offered yet: no route has been checked end to end for steps, kerbs and slopes.</p>`;
    out.querySelector('.nav-start')?.addEventListener('click', startNavigation);
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
    // from your own position the character marks the start; a picked spot gets its A
    if (Array.isArray(from)) { if (pointOf(fromValue)) startMarker.setLngLat(from).addTo(map); else startMarker.remove(); }
    else startMarker.setLngLat(from.position).addTo(map);
    // B only where it adds something: right by the destination's own pin it would just cover it
    const destPin = current ? (markers.get(current.id)?.at ?? current.position) : null;
    if (destPin && distanceM(routeEnd, destPin) < 30) endMarker.remove(); else endMarker.setLngLat(routeEnd).addTo(map);
    xrayKey = '';
    if (quiet) { scheduleXray(); return; }
    const all = [...r.coordinates, ...r.startHop, Array.isArray(from) ? from : from.position];
    // a lower tilt for the overview, so the far end of a long route stays readable
    requestAnimationFrame(() => fitPoints(all, { pitch: tilt(40), maxZoom: 18, side: 48 }));
  }
  function clearRoute() {
    panel.classList.remove('route-peek');
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
  const XRAY_LAYERS = ['building-walls', 'building-roof', 'building-top', 'roof-solar', 'roof-solar-far', 'building-ghost'];
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
        if (id === current?.footprintId || id === routeFrom?.footprintId) continue; // where you're going (and from) stay solid
        if ((outlines.get(id) ?? []).some((ring) => touches(p, ring, 3))) continue; // the route runs along or into this one: it isn't in the way
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
          <b id="panel-name" tabindex="-1">${esc(destName(current))}</b>
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
    navId++;
    hideList();
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
    const a = along(f.pos, routeLine);
    const out = document.querySelector('#nav-left');
    const off = a.off > 35 && f.accuracy <= 25;
    offCount = off ? offCount + 1 : 0;
    if (out && !out.classList.contains('arrived')) out.textContent = navText(a.left + (off ? a.off : 0)) + (off ? ' · off the route' : '');
    // twice in a row and not too often: a new route from where you are now (only when it started from you)
    if (offCount >= 2 && fromValue === 'me' && Date.now() - lastReroute > 15000 && distanceToBounds(f.pos, doc.bounds) === 0) {
      lastReroute = Date.now();
      offCount = 0;
      const r = router.route(f.pos, routeTarget(current), footprints);
      // only when it really is a different way (not the same path from the same first node)
      const same = r && lastRoute.coordinates.length === r.coordinates.length && distanceM(lastRoute.coordinates[0], r.coordinates[0]) < 1;
      if (r && !same) { drawRoute(r, f.pos, true); renderNav(); toast('New route from where you are', 2500); }
    }
  }

  // tap a building footprint (footprintToPlace picks the building, so a café doesn't take it over)
  map?.on('click', (e) => {
    hideResults();
    if (pickingStart && current && directionsOpen) {
      // "Pick on the map": this tap is the start
      fromValue = `pt:${e.lngLat.lng.toFixed(6)},${e.lngLat.lat.toFixed(6)}`;
      const inp = document.querySelector<HTMLInputElement>('#from-input');
      if (inp) inp.value = fromLabel(fromValue);
      planRoute();
      return;
    }
    if (!key.hidden) toggleKey(false);
    if (navigating) return; // while walking, stray taps on the map shouldn't end the route
    const f = map!.queryRenderedFeatures(e.point, { layers: ['building-walls', 'building-roof', 'building-top', 'building-ghost'] })[0];
    const p = f && footprintToPlace.get(pickHalf(f.properties?.osmId, [e.lngLat.lng, e.lngLat.lat]));
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
  type Option = { kind: 'place'; place: Place; room?: string } | { kind: 'group'; group: GroupId };
  let options: Option[] = [];

  let announceTimer = 0;
  /** a short polite message for screen readers, after typing pauses */
  function announce(msg: string) {
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => { $('#sr-status').textContent = msg; }, 600);
  }
  function hideResults() { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  function plural(n: number, one: string, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }
  /** a filter or "Open now" narrowing what you see */
  function narrowed() { return filter !== 'all' || (openOnly && openApplies()); }
  function clearFilters() { setOpenOnly(false); setFilter('all'); }
  function showResults() {
    const q = input.value.trim();
    clearBtn.hidden = !input.value;
    if (!$('#list').hidden) renderList();
    if (!q) { hideResults(); return; }
    // search always looks at every place: matches in the chosen category come first, the rest
    // follow under "Other categories", so a category never hides what you typed
    const hits = search(q, places, 12);
    const inside = narrowed() ? hits.filter((h) => passes(h.place)).slice(0, 6) : hits.slice(0, 6);
    const outside = narrowed() ? hits.filter((h) => !passes(h.place)).slice(0, inside.length ? 3 : 6) : [];
    const groups = (matchingGroups(q) as GroupId[]).filter((g) => (groupCount.get(g) ?? 0) > 0 && g !== filter);
    options = [...groups.map((group) => ({ kind: 'group' as const, group })), ...[...inside, ...outside].map((h) => ({ kind: 'place' as const, place: h.place, room: h.room }))];
    const via = new Map(hits.map((h) => [h.place.id, h.via]));
    const firstOutside = inside.length + groups.length;
    if (!options.length) {
      results.innerHTML = `<li class="empty"><p>No places match “${esc(q)}”.</p>
        <p class="hint">Try a building name, a code such as D1, a room such as Ma101, or what you need, like printing or coffee.</p>
        <div class="empty-actions"><button class="btn ghost browse">Browse all places</button>${narrowed() ? '<button class="btn ghost reset">Clear filters</button>' : ''}</div></li>`;
      results.querySelector('.browse')!.addEventListener('click', () => { clearFilters(); input.value = ''; clearBtn.hidden = true; hideResults(); showList(); });
      results.querySelector('.reset')?.addEventListener('click', () => { clearFilters(); input.focus(); });
    } else {
      const head = (text: string) => `<li class="res-head" role="presentation">${esc(text)}</li>`;
      results.innerHTML = options.map((o, i) => (narrowed() && i === groups.length && inside.length ? head(`In ${filterLabel(filter)}${openOnly && openApplies() ? ', open now' : ''}`) : '')
        + (narrowed() && outside.length && i === firstOutside ? head(inside.length ? 'Other categories' : `Nothing in ${filterLabel(filter)}${openOnly && openApplies() ? ' open now' : ''}. Other categories:`) : '')
        + (o.kind === 'group'
        ? `<li><button role="option" data-i="${i}"><span class="cat-icon small g-${o.group}">${groupIcon(o.group)}</span>
            <span><b>Show all: ${esc(groupLabel(o.group))}</b><small>${plural(groupCount.get(o.group) ?? 0, 'place')}</small></span></button></li>`
        : `<li><button role="option" data-i="${i}">
            <span class="cat-icon small g-${groupOf(o.place)}">${placeIcon(o.place.category, o.place.kind)}</span>
            <span><b>${esc(o.place.name)}</b>${o.place.code ? ` <span class="code">${esc(o.place.code)}</span>` : ''}
            <small>${esc([via.get(o.place.id) ?? groupLabel(groupOf(o.place)), o.place.college && COLLEGE[o.place.college]].filter(Boolean).join(' · '))}</small></span></button></li>`)).join('');
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    const n = options.filter((o) => o.kind === 'place').length;
    announce(n ? plural(n, 'result') : 'No results');
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
    select(o.place, { source: 'search', room: o.room });
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
  let listSort: 'az' | 'near' | 'open' = 'az';
  /** straight-line distance from a fresh, decent fix on campus, or null */
  const distanceTo = (p: Place) => (fix && !stale && fix.accuracy <= config.weakGpsM && distanceToBounds(fix.pos, doc.bounds) === 0 ? distanceM(fix.pos, p.position) : null);
  /** open / closes soon / closed / hours unknown, for list rows (only where hours matter) */
  function statusBadge(p: Place): string {
    const h = resolveHours(p.id);
    if (!h) return HOURS_MATTER.has(groupOf(p)) ? '<span class="badge unknown">Hours unknown</span>' : '';
    const st = openState(h);
    if (st.kind === 'open') return st.soon ? `<span class="badge soon">Closes ${st.closes}</span>` : '<span class="badge open">Open</span>';
    if (st.kind === 'closed') return '<span class="badge closed">Closed</span>';
    return '<span class="badge unknown">Hours unknown</span>';
  }
  const openRank = (p: Place) => { const h = resolveHours(p.id); const k = h ? openState(h).kind : 'none'; return k === 'open' ? 0 : k === 'closed' ? 1 : 2; };
  /** a row: name and code, category and college, then open/closed and distance; the description waits for the card */
  function listRow(p: Place): string {
    const g = groupOf(p);
    const d = distanceTo(p);
    return `<li><button data-id="${p.id}"><span class="cat-icon small g-${g}">${placeIcon(p.category, p.kind)}</span>
      <span class="row-main"><b>${esc(p.name)}</b>${p.code ? ` <span class="code">${esc(p.code)}</span>` : ''}
      <small>${esc([groupLabel(g), p.college && COLLEGE[p.college], p.offCampus && 'Off campus'].filter(Boolean).join(' · '))}</small></span>
      <span class="row-side">${statusBadge(p)}${d != null ? `<small>${formatDistance(d)}</small>` : ''}</span></button></li>`;
  }
  function renderList() {
    const q = input.value.trim();
    const found = q ? search(q, places, 100).map((h) => h.place) : places;
    const pool = found.filter(passes);
    const body = $('#list-body');
    // "Nearest" needs your location
    const nearBtn = $<HTMLButtonElement>('.list-sort [data-sort=near]');
    nearBtn.disabled = !fix;
    nearBtn.title = fix ? '' : 'Share your location (Find me) to sort by distance';
    if (listSort === 'near' && !fix) listSort = 'az';
    $$('.list-sort [data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === listSort)));
    if (!pool.length) {
      const elsewhere = found.length; // matches hidden by the category or Open now
      body.innerHTML = `<p class="list-empty">${q ? `No places match “${esc(q)}”` : 'Nothing to show'}${narrowed() ? ` in ${esc(filterLabel(filter))}${openOnly && openApplies() ? ' open now' : ''}` : ''}.</p>
        ${narrowed() && elsewhere ? `<p class="list-empty">${plural(elsewhere, 'match', 'matches')} in other categories.</p>` : ''}
        ${narrowed() ? '<button class="btn ghost reset">Clear filters</button>' : ''}`;
      body.querySelector('.reset')?.addEventListener('click', clearFilters);
      return;
    }
    if (listSort === 'az' && !q) {
      body.innerHTML = GROUPS.filter((g) => pool.some((p) => groupOf(p) === g.id)).map((g) => `
        <h3>${g.label}</h3>
        <ul>${pool.filter((p) => groupOf(p) === g.id).sort((a, b) => a.name.localeCompare(b.name)).map(listRow).join('')}</ul>`).join('');
      return;
    }
    // a search keeps its best-first order under A–Z; Nearest and Open now first make one list
    const sorted = listSort === 'near' ? [...pool].sort((a, b) => (distanceTo(a) ?? Infinity) - (distanceTo(b) ?? Infinity))
      : listSort === 'open' ? [...pool].sort((a, b) => openRank(a) - openRank(b) || a.name.localeCompare(b.name))
      : pool;
    body.innerHTML = `<ul>${sorted.map(listRow).join('')}</ul>`;
  }
  $('.list-sort').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-sort]');
    if (!b || b.disabled) return;
    listSort = b.dataset.sort as typeof listSort;
    renderList();
  });
  // phones: the list is a sheet over the lower half of the map; the grip (or a swipe) makes it full height
  const listEl = $('#list');
  const grip = $('.list-grip');
  function setListFull(full: boolean) {
    listEl.classList.toggle('full', full);
    grip.setAttribute('aria-expanded', String(full));
    grip.setAttribute('aria-label', full ? 'Show less of the list' : 'Show more of the list');
  }
  grip.addEventListener('click', () => setListFull(!listEl.classList.contains('full')));
  {
    let y0 = 0, dy = 0, dragging = false;
    grip.addEventListener('touchstart', (e) => { dragging = true; y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
    grip.addEventListener('touchmove', (e) => { if (dragging) dy = e.touches[0].clientY - y0; }, { passive: true });
    grip.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      if (dy < -40) setListFull(true);
      else if (dy > 60) { if (listEl.classList.contains('full')) setListFull(false); else hideList(); }
    });
  }
  function showList(note?: string) {
    renderList();
    const n = $('#list-note');
    n.hidden = !note;
    if (note) n.textContent = note;
    $('#list').hidden = false;
    document.body.classList.add('list-open');
    setTimeout(fitControls, 220);
    listBtn.setAttribute('aria-pressed', 'true');
    listBtn.setAttribute('aria-label', 'Show map');
    listBtn.innerHTML = icons.map;
  }
  function hideList() {
    if (!map) return; // without a map the list is the whole app
    const hadFocus = $('#list').contains(document.activeElement);
    $('#list').hidden = true;
    document.body.classList.remove('list-open');
    setTimeout(fitControls, 220);
    setListFull(false);
    if (hadFocus) listBtn.focus(); // focus goes back to the button that opened it
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
    // No WebGL: the list becomes the app (list beside the details on large screens, one column on
    // phones). Search, categories, saved places, details and text directions all keep working.
    doneLoading();
    document.body.classList.add('no-map');
    listBtn.hidden = true; // there's no map to switch to
    if (!welcome.hidden) { welcome.hidden = true; document.body.classList.remove('hello-open'); } // its Find me / Explore are about the map
    showList();
    const n = $('#list-note');
    n.hidden = false;
    n.innerHTML = `<b>The 3D map isn't available in this browser.</b>
      <span>Everything else works: search, categories, saved places, details and walking directions as text.</span>
      <button type="button" class="btn ghost retry-map">Try the map again</button>`;
    n.querySelector('.retry-map')!.addEventListener('click', () => location.reload());
    $('#map').setAttribute('aria-hidden', 'true');
  }

  // ---------- keyboard: Esc closes the top-most layer ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!about.hidden) closeDialog(about);
    else if (!settings.hidden) closeDialog(settings);
    else if (!welcome.hidden) dismissWelcome(); // same as X: remembered on this device
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
      // a room code only counts if it really belongs to that building
      const room = linkedRoom && p ? parseRoom(linkedRoom, [p]) : null;
      if (p) select(p, { source: 'link', room: room?.code });
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
