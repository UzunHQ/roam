import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import { config } from './config';
import { loadData } from './data';
import { applyTheme, bounceBuilding, createMap, lineFeature, selectBuilding, setGeoJSON, type Theme } from './map';
import { icons, placeIcon } from './icons';
import { search } from './search';
import { circle, distanceToBounds, formatDistance, startCompass, watchLocation, type Fix } from './geo';
import { destinationOf, route } from './route';
import { londonNow, openState, todayText } from './hours';
import { initAnalytics, track } from './analytics';
import type { Place } from './types';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => (el.innerHTML = icons[el.dataset.icon as keyof typeof icons] ?? ''));
$('#author').textContent = config.author;
$<HTMLAnchorElement>('#ig').href = config.links.instagram;
$<HTMLAnchorElement>('#li').href = config.links.linkedin;
initAnalytics();

const COLLEGE_NAME: Record<string, string> = { 'digby-stuart': 'Digby Stuart', froebel: 'Froebel', southlands: 'Southlands' };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const theme = (): Theme => (darkQuery.matches ? 'dark' : 'light');

// ---------- toast ----------
let toastTimer = 0;
function toast(msg: string, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

const { doc, places, campus } = await loadData();
const byId = new Map(places.map((p) => [p.id, p]));
const map = createMap({ container: 'map', campus, bounds: doc.bounds, theme: theme() });
darkQuery.addEventListener('change', () => applyTheme(map, theme()));
// open on the middle of campus, not the whole bounding box
{
  const pts = places.filter((p) => p.category !== 'entrance').map((p) => p.position);
  const center: [number, number] = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  map.jumpTo({ center, zoom: innerWidth < 500 ? 16.1 : 16.7 });
}
// expose for debugging in dev only
if (import.meta.env.DEV) Object.assign(window, { map });

// ---------- markers ----------
const markers = new Map<string, { marker: maplibregl.Marker; el: HTMLElement }>();
for (const p of places) {
  const el = document.createElement('button');
  el.className = `pin pin-${p.category} college-${p.college ?? 'none'}`;
  el.setAttribute('aria-label', p.name);
  el.innerHTML = p.category === 'entrance'
    ? `<span class="gate">${icons.entrance}</span>`
    : `<span class="bubble">${placeIcon(p.category, p.kind)}</span><span class="label">${p.code ? `<b>${esc(p.code)}</b> ` : ''}${esc(p.name)}</span>`;
  el.addEventListener('click', (e) => { e.stopPropagation(); select(p, { source: 'marker' }); });
  const marker = new maplibregl.Marker({ element: el, anchor: p.category === 'entrance' ? 'center' : 'bottom' })
    .setLngLat(p.position)
    .addTo(map);
  markers.set(p.id, { marker, el });
}
const updateLabels = () => {
  document.body.classList.toggle('show-labels', map.getZoom() >= 17.2);
  document.body.classList.toggle('compact-pins', map.getZoom() < 16.8);
};
map.on('zoom', updateLabels);
updateLabels();

// ---------- filters ----------
let filter = 'all';
document.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    filter = chip.dataset.filter!;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    for (const p of places) {
      const show = p.category === 'entrance' || filter === 'all' || p.category === filter;
      markers.get(p.id)!.el.classList.toggle('hidden', !show);
    }
  }),
);

// ---------- location ----------
let fix: Fix | null = null;
let compassHeading: number | null = null;
let compassRefused = false;
let stopWatch: (() => void) | null = null;
let followOnFix = false;
let routeTo: Place | null = null;

const avatarEl = document.createElement('div');
avatarEl.className = 'avatar';
avatarEl.innerHTML = '<div class="arrow" hidden></div><div class="body"><div class="face"></div></div><div class="shadow"></div>';
const avatar = new maplibregl.Marker({ element: avatarEl, anchor: 'center' });

function drawHeading() {
  const arrow = avatarEl.querySelector<HTMLElement>('.arrow')!;
  const h = compassHeading ?? (compassRefused ? null : fix?.heading ?? null);
  arrow.hidden = h == null;
  if (h != null) arrow.style.transform = `rotate(${h - map.getBearing()}deg)`;
}
map.on('rotate', drawHeading);

let lastWeak = false, lastOff = false;
function onFix(f: Fix) {
  const first = !fix;
  fix = f;
  avatar.setLngLat(f.pos);
  if (first) avatar.addTo(map);
  setGeoJSON(map, 'user', { type: 'Feature', properties: {}, geometry: circle(f.pos, f.accuracy) });
  drawHeading();
  $('#findme').classList.add('active');

  const off = distanceToBounds(f.pos, doc.bounds);
  const weak = f.accuracy > config.weakGpsM;
  if (off > 0 && (!lastOff || first)) toast(`You're not on campus yet · ${formatDistance(off)} to campus`, 6000);
  else if (weak && !lastWeak && off === 0) toast('GPS is weak here', 5000);
  lastOff = off > 0;
  lastWeak = weak;

  if (followOnFix && off === 0 && !routeTo) {
    followOnFix = false;
    map.easeTo({ center: f.pos, zoom: Math.max(map.getZoom(), 17.5), duration: 600 });
  }
  if (routeTo) drawRoute(routeTo, first);
}

function startLocation() {
  if (!('geolocation' in navigator)) { toast('This browser cannot share location. The map still works.'); return; }
  // compass must be requested inside the tap (iOS)
  startCompass((h) => { compassHeading = h; drawHeading(); }).then((ok) => {
    if (!ok) { compassRefused = true; compassHeading = null; drawHeading(); }
  });
  followOnFix = true;
  stopWatch?.();
  stopWatch = watchLocation({
    onFix,
    onError: (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        stopWatch?.(); stopWatch = null; routeTo = null;
        $('#findme').classList.remove('active');
        toast('Location is off. The map still works; you can allow it in your browser settings.', 6000);
      } else if (!fix) toast('Still looking for GPS…', 4000);
    },
  });
}

/** Ask with a one-line reason the first time, then go straight to the browser prompt. */
function requestLocation() {
  if (stopWatch) {
    if (fix) {
      if (distanceToBounds(fix.pos, doc.bounds) > 0) toast(`You're not on campus yet · ${formatDistance(distanceToBounds(fix.pos, doc.bounds))} to campus`);
      else map.easeTo({ center: fix.pos, zoom: Math.max(map.getZoom(), 17.5), duration: 500 });
    }
    return;
  }
  if (store.get('roam.locationAsked')) { startLocation(); return; }
  $('#ask').hidden = false;
}
$('#ask').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ask]');
  if (!b) return;
  $('#ask').hidden = true;
  if (b.dataset.ask === 'yes') { store.set('roam.locationAsked', '1'); startLocation(); }
  else routeTo = null;
});
$('#findme').addEventListener('click', requestLocation);
$('#north').addEventListener('click', () => map.easeTo({ bearing: 0, pitch: 55, duration: 500 }));

// ---------- route ----------
function drawRoute(p: Place, fit: boolean) {
  if (!fix) return;
  const r = route(fix.pos, destinationOf(p));
  setGeoJSON(map, 'route', lineFeature(r.coordinates));
  const info = document.querySelector('#route-info');
  if (info) {
    const off = distanceToBounds(fix.pos, doc.bounds);
    info.innerHTML = `${icons.walk}<span><b>${formatDistance(r.distanceM)}</b> · about ${r.minutes} min walk${off > 0 ? `<br><small>You're not on campus yet</small>` : ''}${!p.entrance ? '<br><small>To the building, entrance not mapped yet</small>' : ''}</span>`;
    info.removeAttribute('hidden');
  }
  if (fit) {
    sheet.classList.add('routing'); // hide photo + description so the route has room
    const b = new maplibregl.LngLatBounds(r.coordinates[0], r.coordinates[0]).extend(r.coordinates[1]);
    requestAnimationFrame(() => {
      // fitBounds adds to the camera's current padding, so clear the one set when the card opened
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      const footer = $('.footer').offsetHeight;
      map.fitBounds(b, {
        padding: { top: 150, left: 50, right: 50, bottom: Math.max(40, Math.min(sheetHeight(), innerHeight * 0.5) - footer + 30) },
        maxZoom: 18, duration: 600,
      });
    });
  }
}
function clearRoute() {
  routeTo = null;
  sheet.classList.remove('routing');
  setGeoJSON(map, 'route', { type: 'FeatureCollection', features: [] });
}

// ---------- bottom sheet ----------
const sheet = $('#sheet');
const sheetHeight = () => (sheet.classList.contains('open') ? sheet.offsetHeight : 0);
const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function badge(p: Place): string {
  if (p.category === 'entrance') return '';
  const s = openState(p.hours, londonNow());
  const [cls, text] =
    s.kind === 'open' ? ['open', `Open now · until ${s.until}`]
    : s.kind === 'opens-later' ? ['closed', `Closed · opens ${s.at}`]
    : s.kind === 'closed-today' ? ['closed', 'Closed today']
    : ['unknown', 'Hours not listed'];
  return `<div class="hours"><span class="badge ${cls}">${text}</span>${p.hours ? `<span class="today">${todayText(p.hours)}</span>` : ''}</div>
    ${p.hours?.notes ? `<p class="notes">${esc(p.hours.notes)}</p>` : ''}`;
}

function renderSheet(p: Place) {
  const mail = `mailto:${config.reportEmail}?subject=${encodeURIComponent(`Roam mistake: ${p.name}`)}&body=${encodeURIComponent(`What's wrong?\n\n\n(place id: ${p.id})`)}`;
  const college = p.college ? COLLEGE_NAME[p.college] : '';
  $('#sheet-body').innerHTML = `
    ${p.photo
      ? `<img class="photo" src="/${esc(p.photo)}" alt="Entrance of ${esc(p.name)}" loading="lazy" decoding="async" width="800" height="450">`
      : `<div class="photo placeholder college-${p.college ?? 'none'}">${placeIcon(p.category, p.kind)}<span>Photo coming soon</span></div>`}
    <div class="sheet-head">
      <span class="cat-icon pin-${p.category} college-${p.college ?? 'none'}">${placeIcon(p.category, p.kind)}</span>
      <div class="titles">
        <h2 id="sheet-name">${esc(p.name)}</h2>
        <p class="meta">${[p.code && `<span class="code">${esc(p.code)}</span>`, college].filter(Boolean).join(' · ')}</p>
      </div>
      <button class="icon-btn close" aria-label="Close">${icons.close}</button>
    </div>
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${badge(p)}
    <button class="btn primary way">${icons.walk}<span>Show me the way</span></button>
    <p id="route-info" class="route-info" hidden></p>
    <p class="small">${p.lastVerified ? `Last checked ${fmtDate(p.lastVerified)} · ` : ''}<a href="${mail}">Report a mistake</a></p>`;
  sheet.querySelector('.close')!.addEventListener('click', () => closeSheet());
  sheet.querySelector('.way')!.addEventListener('click', () => {
    routeTo = p;
    if (fix) drawRoute(p, true);
    else requestLocation();
  });
}

let current: Place | null = null;
function select(p: Place, opts: { source: 'marker' | 'building' | 'search' | 'link' }) {
  if (current?.id !== p.id) clearRoute();
  current = p;
  renderSheet(p);
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  document.querySelectorAll('.pin.selected').forEach((el) => el.classList.remove('selected'));
  markers.get(p.id)?.el.classList.add('selected');
  selectBuilding(map, p.footprintId);
  if (p.footprintId) bounceBuilding(map, p.footprintId);
  history.replaceState(null, '', `?place=${encodeURIComponent(p.id)}`);
  track('place-tap', { id: p.id, via: opts.source });
  // move after the sheet is visible so it never waits on the camera
  requestAnimationFrame(() =>
    map.easeTo({
      center: p.position,
      zoom: Math.max(map.getZoom(), opts.source === 'link' || opts.source === 'search' ? 17.6 : 17),
      padding: { top: 120, bottom: Math.min(sheet.offsetHeight, innerHeight * 0.6), left: 0, right: 0 },
      duration: opts.source === 'link' ? 0 : 500,
    }),
  );
}

function closeSheet() {
  current = null;
  clearRoute();
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.pin.selected').forEach((el) => el.classList.remove('selected'));
  selectBuilding(map, null);
  history.replaceState(null, '', location.pathname);
  map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 });
}

// swipe the sheet down to close
let dragY: number | null = null;
sheet.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('.handle, .sheet-head')) dragY = e.clientY; });
addEventListener('pointerup', (e) => { if (dragY != null && e.clientY - dragY > 60) closeSheet(); dragY = null; });

// tap a building footprint
const footprintToPlace = new Map(places.filter((p) => p.footprintId).map((p) => [p.footprintId!, p]));
map.on('click', (e) => {
  const f = map.queryRenderedFeatures(e.point, { layers: ['building-walls', 'building-roof'] })[0];
  const osmId = f?.properties?.osmId as string | undefined;
  hideResults();
  if (osmId) {
    bounceBuilding(map, osmId);
    const p = footprintToPlace.get(osmId);
    if (p) { select(p, { source: 'building' }); return; }
  }
  if (current) closeSheet();
});
map.on('mousemove', (e) => {
  const hit = map.queryRenderedFeatures(e.point, { layers: ['building-walls'] }).some((f) => footprintToPlace.has(f.properties?.osmId));
  map.getCanvas().style.cursor = hit ? 'pointer' : '';
});

// ---------- search ----------
const input = $<HTMLInputElement>('#q');
const results = $('#results');
const clearBtn = $('.search .clear');
let hits: ReturnType<typeof search> = [];

function hideResults() { results.hidden = true; }
function showResults() {
  hits = search(input.value, places);
  clearBtn.hidden = !input.value;
  if (!input.value.trim()) { hideResults(); return; }
  results.innerHTML = hits.length
    ? hits.map((h, i) => `<li><button role="option" data-i="${i}">
        <span class="cat-icon small pin-${h.place.category} college-${h.place.college ?? 'none'}">${placeIcon(h.place.category, h.place.kind)}</span>
        <span><b>${esc(h.place.name)}</b>${h.place.code ? ` <span class="code">${esc(h.place.code)}</span>` : ''}
        ${h.via ? `<small>${esc(h.via)}</small>` : ''}</span></button></li>`).join('')
    : `<li class="empty">No match. Try a building name, code like D1, or a room like Ma101.</li>`;
  results.hidden = false;
}
function pick(i: number) {
  const h = hits[i];
  if (!h) return;
  track('search', { q: input.value.trim().toLowerCase().slice(0, 40), id: h.place.id });
  input.value = '';
  clearBtn.hidden = true;
  hideResults();
  input.blur();
  select(h.place, { source: 'search' });
}
input.addEventListener('input', showResults);
input.addEventListener('focus', () => input.value && showResults());
results.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
  if (b) pick(Number(b.dataset.i));
});
$('.search').addEventListener('submit', (e) => { e.preventDefault(); pick(0); });
clearBtn.addEventListener('click', () => { input.value = ''; showResults(); input.focus(); });

// ---------- deep link: /?place=<id> ----------
map.once('load', () => {
  const id = new URLSearchParams(location.search).get('place');
  const p = id ? byId.get(id) : undefined;
  if (p) select(p, { source: 'link' });
  else if (id) history.replaceState(null, '', location.pathname);
});

// ---------- offline ----------
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // main.ts awaits data first, so the load event may already have fired
  const register = () => navigator.serviceWorker.register('/sw.js');
  if (document.readyState === 'complete') register();
  else addEventListener('load', register);
}
