import placesUrl from '../data/places.json?url';
import campusUrl from '../data/campus.geojson?url';
import pathsUrl from '../data/paths.json?url';
import type { PathGraph } from './route';
import type { Place, PlacesDoc } from './types';

export { placesUrl, campusUrl };

async function getJSON<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000); // never an endless spinner
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadData(): Promise<{ doc: PlacesDoc; places: Place[]; campus: GeoJSON.FeatureCollection; paths: PathGraph }> {
  const [doc, campus, paths] = await Promise.all([
    getJSON<PlacesDoc>(placesUrl),
    getJSON<GeoJSON.FeatureCollection>(campusUrl),
    getJSON<PathGraph>(pathsUrl),
  ]);
  // pending-legend places are never shown until their names are confirmed
  const places = doc.places.filter((p) => p.status !== 'pending-legend');
  return { doc, places, campus, paths };
}
