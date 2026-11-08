import placesUrl from '../data/places.json?url';
import campusUrl from '../data/campus.geojson?url';
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

export async function loadData(): Promise<{ doc: PlacesDoc; places: Place[]; campus: GeoJSON.FeatureCollection; walls: GeoJSON.FeatureCollection; paths: PathGraph }> {
  const [doc, campus, paths, walls] = await Promise.all([
    getJSON<PlacesDoc>(placesUrl),
    getJSON<GeoJSON.FeatureCollection>(campusUrl),
    getJSON<PathGraph>(pathsUrl),
    getJSON<GeoJSON.FeatureCollection>(wallsUrl),
  ]);
  // pending-legend places are never shown until their names are confirmed
  const places = doc.places.filter((p) => p.status !== 'pending-legend');
  return { doc, places, campus, walls, paths };
}
