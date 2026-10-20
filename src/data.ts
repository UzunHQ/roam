import placesUrl from '../data/places.json?url';
import campusUrl from '../data/campus.geojson?url';
import type { Place, PlacesDoc } from './types';

export { placesUrl, campusUrl };

export async function loadData(): Promise<{ doc: PlacesDoc; places: Place[]; campus: GeoJSON.FeatureCollection }> {
  const [doc, campus] = await Promise.all([
    fetch(placesUrl).then((r) => r.json() as Promise<PlacesDoc>),
    fetch(campusUrl).then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
  ]);
  // pending-legend places are never shown until their names are confirmed
  const places = doc.places.filter((p) => p.status !== 'pending-legend');
  return { doc, places, campus };
}
