// GPS recording, for measuring how well the location works on campus (docs/GPS.md). ?gpslog in the
// address only asks: nothing is recorded until the person agrees (the answer is remembered for the
// tab), so a link alone can't start it. Then every raw reading from the phone,
// and where the app showed you, go into this device's IndexedDB. Nothing is sent anywhere. While
// it records, the map says so; Settings has "Download GPS log (GPX + JSON)", "Stop recording" and
// "Delete log", and keeps the first and last of these for as long as the device holds a recording.
import type { LngLat } from './types';

export interface GpsLogEntry {
  /** raw reading */
  lat: number; lon: number; accuracy: number;
  speed: number | null; heading: number | null; altitude: number | null; altitudeAccuracy: number | null;
  timestamp: number;
  /** what the app did with it: shown, rejected (a jump), or waiting for a better first reading */
  step: 'show' | 'reject' | 'wait';
  /** where the character stood ([lng, lat]), and the filtered position (not moved onto a path) */
  shown: LngLat | null;
  filtered: LngLat | null;
  on: string | null;
  inside: string | null;
}

const DB = 'roam-gpslog', STORE = 'fixes';
const FLAG = 'roam.gpslog'; // this tab's answer: '1' record, '0' don't
const HAS = 'roam.gpslog.has'; // this device has recorded (for browsers that can't list their databases)

/** is the recording on in this tab? Only after the person agreed. */
export function gpsLogOn(): boolean {
  try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; }
}
/** ?gpslog is in the address and this tab isn't recording: ask before recording anything */
export function gpsLogAsks(): boolean {
  try { return new URLSearchParams(location.search).has('gpslog') && sessionStorage.getItem(FLAG) !== '1'; } catch { return false; }
}
export function answerGpsLog(record: boolean) {
  try { sessionStorage.setItem(FLAG, record ? '1' : '0'); } catch { /* private mode: nothing is recorded */ }
}
/** how many readings this device holds, without creating the database on a device that never recorded */
export async function gpsLogCount(): Promise<number> {
  try {
    if (typeof indexedDB.databases === 'function') {
      if (!(await indexedDB.databases()).some((d) => d.name === DB)) return 0;
    } else if (localStorage.getItem(HAS) !== '1') return 0;
    return (await readGpsLog()).length;
  } catch { return 0; }
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
const done = (t: IDBTransaction) => new Promise<void>((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });

export async function logGps(e: GpsLogEntry) {
  try {
    const t = (await db()).transaction(STORE, 'readwrite');
    t.objectStore(STORE).add(e);
    await done(t);
    try { localStorage.setItem(HAS, '1'); } catch { /* ignore */ }
  } catch (err) { console.warn('gps log', err); }
}

export async function readGpsLog(): Promise<GpsLogEntry[]> {
  const t = (await db()).transaction(STORE, 'readonly');
  const req = t.objectStore(STORE).getAll();
  await done(t);
  return req.result as GpsLogEntry[];
}

export async function clearGpsLog() {
  const t = (await db()).transaction(STORE, 'readwrite');
  t.objectStore(STORE).clear();
  await done(t);
  try { localStorage.removeItem(HAS); } catch { /* ignore */ }
}

const iso = (ms: number) => new Date(ms).toISOString();
const x = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** two tracks: the raw readings, and where the character was shown */
export function toGpx(entries: GpsLogEntry[]): string {
  const pt = (lon: number, lat: number, e: GpsLogEntry, extra = '') =>
    `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${e.altitude != null ? `<ele>${e.altitude.toFixed(1)}</ele>` : ''}<time>${iso(e.timestamp)}</time>${extra}</trkpt>`;
  const raw = entries.map((e) => pt(e.lon, e.lat, e, `<desc>${x(`accuracy ${Math.round(e.accuracy)} m; ${e.step}`)}</desc>`)).join('\n');
  const shown = entries.filter((e) => e.shown).map((e) => pt(e.shown![0], e.shown![1], e)).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Roam GPS log" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>Raw readings</name><trkseg>
${raw}
</trkseg></trk>
<trk><name>Shown in Roam</name><trkseg>
${shown}
</trkseg></trk>
</gpx>
`;
}
