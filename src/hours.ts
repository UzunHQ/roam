import type { Day } from './types';
import { HOURS, LIVE, type HoursEntry } from './data/hours';

const DAYS: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAME: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
type Ranges = [string, string][];

/** Today's date, weekday and minutes since midnight in Europe/London, whatever the phone's timezone (BST/GMT included). */
export function londonNow(at = new Date()): { date: string; day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return { date, day: dayOf(date), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

// dates are plain calendar days: count them in UTC so no clock change gets in the way
const dayNumber = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
const addDays = (iso: string, n: number) => new Date((dayNumber(iso) + n) * 86400000).toISOString().slice(0, 10);
const dayOf = (iso: string) => DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** A place's hours, ready to ask about any date: undefined = not listed that day, [] = closed. */
export interface Resolved {
  on: (date: string) => Ranges | undefined;
  source: HoursEntry['source'];
  checked: string;
  live: boolean;
  stale: boolean; // typed-in hours that are too old, or whose period is over
  notes?: string;
  serving?: string;
  unknown?: string; // what to say on a day with no listed hours
}

// ---------- live hours (LibCal): fetched on the phone, saved for the next visit ----------
type LiveDays = { fetched: number; days: Record<string, Ranges | null> }; // null: not set for that day
const live = new Map<string, LiveDays>();
const liveKey = (id: string) => `roam.hours.${id}`;
const FRESH_MS = 6 * 3600 * 1000;
for (const id of Object.keys(LIVE)) {
  try {
    const saved = JSON.parse(localStorage.getItem(liveKey(id)) ?? 'null') as LiveDays | null;
    if (saved?.days && saved.fetched) live.set(id, saved);
  } catch { /* private mode or bad data: fetch again */ }
}

/** "8am", "11:59pm", "12:30pm" → "08:00", "23:59", "12:30" */
function clock(s: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(s.trim());
  if (!m) return null;
  return toHHMM(((Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(m[2] ?? 0));
}

type LibCalDay = { date: string; times: { status: string; hours?: { from: string; to: string }[] } };
export function parseLibCal(json: unknown, lid: number): Record<string, Ranges | null> {
  const doc = json as { locations?: unknown[] } & Record<string, unknown>;
  const locs = (doc.locations ?? Object.values(doc)) as { lid: number; weeks: Record<string, LibCalDay>[] }[];
  const loc = locs.find((l) => l?.lid === lid);
  if (!loc) throw new Error(`LibCal: no location ${lid}`);
  const days: Record<string, Ranges | null> = {};
  for (const week of loc.weeks) {
    for (const d of Object.values(week)) {
      const t = d.times;
      if (t.status === 'closed') days[d.date] = [];
      else if (t.status === '24hours') days[d.date] = [['00:00', '24:00']];
      else if (t.status === 'open' && t.hours?.length) {
        const r = t.hours.map((h) => [clock(h.from), clock(h.to)]);
        days[d.date] = r.every(([a, b]) => a && b) ? (r as Ranges) : null;
      } else days[d.date] = null; // not set, or only a text note: we don't guess
    }
  }
  return days;
}

/** Fetches live hours, at most every 6 hours. Resolves true when new hours arrived. */
export async function refreshLiveHours(): Promise<boolean> {
  let changed = false;
  await Promise.all(Object.entries(LIVE).map(async ([id, { iid, lid }]) => {
    if (Date.now() - (live.get(id)?.fetched ?? 0) < FRESH_MS) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`https://roehampton.libcal.com/api_hours_grid.php?iid=${iid}&format=json&weeks=4&systemTime=0`, { signal: ctl.signal });
      if (!res.ok) throw new Error(`LibCal ${res.status}`);
      const got: LiveDays = { fetched: Date.now(), days: parseLibCal(await res.json(), lid) };
      live.set(id, got);
      changed = true;
      try { localStorage.setItem(liveKey(id), JSON.stringify(got)); } catch { /* private mode: fine */ }
    } catch (err) {
      console.warn('[roam] live hours unavailable, using saved or typed-in hours', err);
    } finally {
      clearTimeout(timer);
    }
  }));
  return changed;
}

// ---------- which hours apply ----------
const STALE_DAYS = 30;

export function resolveHours(placeId: string, now = londonNow()): Resolved | null {
  const entries = HOURS.filter((h) => h.place === placeId);
  const l = live.get(placeId);
  if (l && l.days[now.date] !== undefined) {
    return {
      on: (d) => l.days[d] ?? undefined, source: LIVE[placeId].source, live: true, stale: false,
      checked: londonNow(new Date(l.fetched)).date, notes: entries[0]?.notes, unknown: entries[0]?.unknown,
    };
  }
  if (!entries.length) return null;
  // the period covering today, else the latest one (which is then out of date)
  const within = (h: HoursEntry, d: string) => h.from <= d && (!h.to || d <= h.to);
  const e = entries.find((h) => within(h, now.date)) ?? [...entries].sort((a, b) => (b.to ?? '9999').localeCompare(a.to ?? '9999'))[0];
  const stale = !within(e, now.date) || dayNumber(now.date) - dayNumber(e.checked) > STALE_DAYS;
  return {
    on: (d) => (within(e, d) ? e.weekly[dayOf(d)] : undefined),
    source: e.source, checked: e.checked, live: false, stale, notes: e.notes, serving: e.serving, unknown: e.unknown,
  };
}

// ---------- open or closed ----------
export type OpenState =
  | { kind: 'open'; closes: string | null; soon: boolean } // closes null: open round the clock
  | { kind: 'closed'; opens: string | null } // "10:00" (today), "Mon 08:00", or null: not listed
  | { kind: 'unknown' } // no hours listed for today: never counts as open
  | { kind: 'stale' }; // hours may have changed

const SOON_MIN = 30;

export function openState(h: Resolved, now = londonNow()): OpenState {
  if (h.stale) return { kind: 'stale' };
  // every opening from yesterday (it may run past midnight) to a week ahead, in minutes from today 00:00
  const spans: { start: number; end: number; day: number }[] = [];
  for (let i = -1; i <= 7; i++) {
    for (const [o, c] of h.on(addDays(now.date, i)) ?? []) {
      spans.push({ start: i * 1440 + toMin(o), end: i * 1440 + toMin(c) + (toMin(c) <= toMin(o) ? 1440 : 0), day: i });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const t = now.minutes;
  const at = spans.find((s) => s.start <= t && t < s.end);
  if (at) {
    // back-to-back openings (open all day, days running) count as one
    let end = at.end;
    for (const s of spans) if (s.start <= end && s.end > end) end = s.end;
    if (end - t >= 2 * 1440) return { kind: 'open', closes: null, soon: false };
    return { kind: 'open', closes: toHHMM(end % 1440), soon: end - t <= SOON_MIN };
  }
  if (h.on(now.date) === undefined) return { kind: 'unknown' };
  // the next opening, unless a day with no listed hours comes first
  for (let i = 0; i <= 7; i++) {
    const date = addDays(now.date, i);
    if (h.on(date) === undefined) break;
    const next = spans.find((s) => s.day === i && s.start > t);
    if (next) return { kind: 'closed', opens: i === 0 ? toHHMM(next.start) : `${DAY_NAME[dayOf(date)]} ${toHHMM(next.start - i * 1440)}` };
  }
  return { kind: 'closed', opens: null };
}

/** Only places with hours can be open: unknown (or out-of-date) hours never count. */
export function isOpenNow(placeId: string, now = londonNow()): boolean {
  const h = resolveHours(placeId, now);
  return !!h && openState(h, now).kind === 'open';
}

/** The coming week, today first: ["Today", "08:00–23:59"], ["Sat", "Closed"]… */
export function weekRows(h: Resolved, now = londonNow()): [string, string][] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(now.date, i);
    const r = h.on(date);
    const text = r === undefined ? h.unknown ?? 'Not listed' : !r.length ? 'Closed'
      : r.some(([o, c]) => o === '00:00' && c === '24:00') ? 'Open 24 hours' : r.map(([o, c]) => `${o}–${c}`).join(', ');
    return [i === 0 ? 'Today' : DAY_NAME[dayOf(date)], text];
  });
}
