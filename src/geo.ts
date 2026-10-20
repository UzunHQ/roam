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
}

export interface LocationCallbacks {
  onFix(fix: Fix): void;
  onError(err: GeolocationPositionError): void;
}

/** Location stays on the device: nothing here is sent anywhere. */
export function watchLocation(cb: LocationCallbacks): () => void {
  const id = navigator.geolocation.watchPosition(
    (p) => cb.onFix({
      pos: [p.coords.longitude, p.coords.latitude],
      accuracy: p.coords.accuracy,
      heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 0.5 ? p.coords.heading : null,
    }),
    cb.onError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Compass heading. Must be called from a tap (iOS asks for permission).
 * Resolves false when there is no compass or permission was refused.
 */
export async function startCompass(onHeading: (deg: number) => void): Promise<boolean> {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  const DOE = DeviceOrientationEvent as IOSOrientation;
  if (typeof DOE.requestPermission === 'function') {
    try {
      if ((await DOE.requestPermission()) !== 'granted') return false;
    } catch {
      return false;
    }
  }
  return new Promise((resolve) => {
    let got = false;
    const handler = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      let h: number | null = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
      if (h == null) return;
      if (!got) { got = true; resolve(true); }
      onHeading(h);
    };
    const absEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(absEvent, handler as EventListener);
    setTimeout(() => { if (!got) { window.removeEventListener(absEvent, handler as EventListener); resolve(false); } }, 1500);
  });
}
