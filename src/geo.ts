import type { LngLat } from './types';

export function distanceM([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Metres from a point to a [w,s,e,n] box; 0 when inside. */
export function distanceToBounds(p: LngLat, [w, s, e, n]: [number, number, number, number]): number {
  const clamped: LngLat = [Math.min(Math.max(p[0], w), e), Math.min(Math.max(p[1], s), n)];
  return distanceM(p, clamped);
}

/** Polygon approximating a circle of `radiusM` metres, for the GPS accuracy ring. */
export function circle([lng, lat]: LngLat, radiusM: number, steps = 48): GeoJSON.Polygon {
  const coords: LngLat[] = [];
  const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`);

export interface Fix {
  pos: LngLat;
  accuracy: number;
  /** degrees from north, from GPS (only while moving) */
  heading: number | null;
  /** m/s when the phone reports it, otherwise null */
  speed: number | null;
  /** ms timestamp of the reading */
  time: number;
}

const toFix = (p: GeolocationPosition): Fix => {
  const speed = p.coords.speed != null && p.coords.speed >= 0 && !Number.isNaN(p.coords.speed) ? p.coords.speed : null;
  return {
    pos: [p.coords.longitude, p.coords.latitude],
    accuracy: p.coords.accuracy,
    heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) && (speed ?? 0) > 0.5 ? p.coords.heading : null,
    speed,
    time: p.timestamp || Date.now(),
  };
};

/** One position fix, on request. Location stays on the device: nothing here is sent anywhere. */
export function getFix(): Promise<Fix> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition((p) => resolve(toFix(p)), reject, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }),
  );
}

/** Keeps reporting your position until the returned stop function is called. Also stays on the device. */
export function watchFix(onFix: (f: Fix) => void, onError: (e: GeolocationPositionError) => void): () => void {
  const id = navigator.geolocation.watchPosition((p) => onFix(toFix(p)), onError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
  return () => navigator.geolocation.clearWatch(id);
}

type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Compass heading. Must be called from a tap (iOS asks for permission).
 * Resolves to a stop function, or null when there is no compass or permission was refused.
 */
export async function startCompass(onHeading: (deg: number) => void): Promise<(() => void) | null> {
  if (typeof DeviceOrientationEvent === 'undefined') return null;
  const DOE = DeviceOrientationEvent as IOSOrientation;
  if (typeof DOE.requestPermission === 'function') {
    try {
      if ((await DOE.requestPermission()) !== 'granted') return null;
    } catch {
      return null;
    }
  }
  const absEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  return new Promise((resolve) => {
    let got = false;
    const handler = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      let h: number | null = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
      if (h == null) return;
      if (!got) { got = true; resolve(stop); }
      onHeading(h);
    };
    const stop = () => window.removeEventListener(absEvent, handler as EventListener);
    window.addEventListener(absEvent, handler as EventListener);
    setTimeout(() => { if (!got) { stop(); resolve(null); } }, 1500);
  });
}
