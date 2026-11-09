import placesUrl from '../data/places.json?url';
import campusUrl from '../data/campus.app.json?url';
import pathsUrl from '../data/paths.json?url';
import wallsUrl from '../data/walls.geojson?url';
import type { PathGraph } from './route';
import type { Place, PlacesDoc } from './types';

export { placesUrl, campusUrl };

/**
 * Fetch JSON, giving up only when nothing has arrived for 20 s: a slow phone connection (sharing
 * its bandwidth with the map download) still gets there, a dead one gets the retry message.
 */
async function getJSON<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), 20000);
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), 20000); };
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    if (!r.body) return (await r.json()) as T;
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
      alive();
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const part of parts) { all.set(part, at); at += part.length; }
    return JSON.parse(new TextDecoder().decode(all)) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadData(): Promise<{ doc: PlacesDoc; places: Place[]; campus: GeoJSON.FeatureCollection; walls: GeoJSON.FeatureCollection }> {
  const [doc, campus, walls] = await Promise.all([
    getJSON<PlacesDoc>(placesUrl),
    getJSON<GeoJSON.FeatureCollection>(campusUrl),
    getJSON<GeoJSON.FeatureCollection>(wallsUrl),
  ]);
  // pending-legend places are never shown until their names are confirmed
  const places = doc.places.filter((p) => p.status !== 'pending-legend');
  return { doc, places, campus: unpackCampus(campus), walls };
}

/**
 * The walking graph is only needed for directions, so it isn't part of the first download: main.ts
 * asks for it once the map has drawn (or straight away, if directions are asked for first).
 */
let pathsPromise: Promise<PathGraph> | null = null;
export const loadPaths = () => (pathsPromise ??= getJSON<PathGraph>(pathsUrl));

/**
 * campus.geojson keeps its ~2,000 trees packed (scripts/slim-geojson.mjs): one feature, layer
 * "treepack", with `pts` = [lng, lat] in millionths of a degree, each a delta from the one before,
 * `s` = size x10 and `f` = flags (1 generated, 2 context, 4 ctx, 8 belt). Unpacked here into the
 * plain Point features the map expects.
 */
export function unpackCampus(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const f of fc.features) {
    const pr = f.properties as { layer?: string; pts?: number[]; s?: number[]; f?: number[] } | null;
    if (pr?.layer !== 'treepack' || !pr.pts) { out.push(f); continue; }
    let x = 0, y = 0;
    for (let i = 0; i < pr.pts.length / 2; i++) {
      x += pr.pts[2 * i]; y += pr.pts[2 * i + 1];
      const fl = pr.f?.[i] ?? 0, s = pr.s?.[i];
      const properties: Record<string, unknown> = { layer: 'tree' };
      if (fl & 1) properties.generated = true;
      if (fl & 2) properties.context = true;
      if (fl & 4) properties.ctx = true;
      if (fl & 8) properties.belt = true;
      if (s) properties.s = s / 10;
      out.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x / 1e6, y / 1e6] } });
    }
  }
  return { ...fc, features: out };
}
