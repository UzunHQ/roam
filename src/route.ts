import { config } from './config';
import { distanceM } from './geo';
import type { LngLat, Place } from './types';

export interface Route {
  coordinates: LngLat[];
  distanceM: number;
  minutes: number;
  /** 'straight' today; 'footpath' once routing over campus.geojson paths is added */
  kind: 'straight' | 'footpath';
}

/** Where to walk to: the picked entrance, or the building point until one is picked. */
export const destinationOf = (p: Place): LngLat => p.entrance ?? p.position;

/**
 * Single entry point for "Show me the way". Swap the body for a footpath graph search
 * (campus.geojson features with layer "path") later; callers won't change.
 */
export function route(from: LngLat, to: LngLat): Route {
  const d = distanceM(from, to);
  return {
    coordinates: [from, to],
    distanceM: d,
    minutes: Math.max(1, Math.round(d / config.walkingSpeedMps / 60)),
    kind: 'straight',
  };
}
