// Dev-only page (npm run dev -> /picker.html). Click the map -> [lng, lat] copied to the clipboard.
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as maplibregl from 'maplibre-gl';
import { campusUrl, placesUrl } from './data';
import { createMap } from './map';
import type { PlacesDoc } from './types';

const [doc, campus] = await Promise.all([fetch(placesUrl).then((r) => r.json() as Promise<PlacesDoc>), fetch(campusUrl).then((r) => r.json())]);
const map = createMap({ container: 'map', campus, bounds: doc.bounds, theme: 'light' });
map.setPitch(0);
map.setMaxZoom(21);
const out = document.getElementById('out')!;
const clicked = new maplibregl.Marker({ color: '#ff6b8b' });

const pins: maplibregl.Marker[] = [];
for (const p of doc.places) {
  const el = document.createElement('div');
  el.className = 'picker-dot' + (p.status === 'pending-legend' ? ' pending' : '');
  el.title = `${p.id}${p.code ? ` (${p.code})` : ''} ±${p.positionAccuracyM} m`;
  el.textContent = p.code || p.name.slice(0, 2);
  pins.push(new maplibregl.Marker({ element: el }).setLngLat(p.position).addTo(map));
  if (p.entrance) {
    const g = document.createElement('div');
    g.className = 'picker-dot entrance';
    g.title = `${p.id} entrance`;
    g.textContent = '⛩';
    new maplibregl.Marker({ element: g }).setLngLat(p.entrance).addTo(map);
  }
  if (p.status === 'pending-legend') el.dataset.pending = '1';
}

map.on('click', async (e) => {
  const ll = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];
  const text = `[${ll[0]}, ${ll[1]}]`;
  clicked.setLngLat(e.lngLat).addTo(map);
  const f = map.queryRenderedFeatures(e.point, { layers: ['building-walls', 'building-roof'] })[0];
  const fp = f ? ` · footprint <code>${f.properties.osmId}</code>${f.properties.name ? ` (${f.properties.name})` : ''}` : '';
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch { /* needs https or localhost */ }
  out.innerHTML = `<code>${text}</code> ${copied ? '✓ copied' : ''}${fp}`;
});

(document.getElementById('tilt') as HTMLInputElement).onchange = (e) => map.easeTo({ pitch: (e.target as HTMLInputElement).checked ? 55 : 0 });
(document.getElementById('pending') as HTMLInputElement).onchange = (e) => {
  const show = (e.target as HTMLInputElement).checked;
  document.querySelectorAll<HTMLElement>('.picker-dot[data-pending]').forEach((el) => (el.style.display = show ? '' : 'none'));
};
