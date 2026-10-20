import type { Day, Hours } from './types';

const DAYS: Day[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Current weekday and minutes since midnight in Europe/London, whatever the phone's timezone. */
export function londonNow(date = new Date()): { day: Day; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = get('weekday').slice(0, 3).toLowerCase() as Day;
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export type OpenState =
  | { kind: 'open'; until: string }
  | { kind: 'opens-later'; at: string }
  | { kind: 'closed-today' }
  | { kind: 'unknown' };

/**
 * A day missing from `hours` means "not listed" (unknown), never "closed".
 * An empty array for a day means closed that day.
 */
export function openState(hours: Hours | null, now = londonNow()): OpenState {
  if (!hours) return { kind: 'unknown' };
  const yesterday = DAYS[(DAYS.indexOf(now.day) + 6) % 7];
  // a range from yesterday that runs past midnight
  for (const [o, c] of hours[yesterday] ?? []) {
    if (toMin(c) <= toMin(o) && now.minutes < toMin(c)) return { kind: 'open', until: c };
  }
  const today = hours[now.day];
  if (!today) return { kind: 'unknown' };
  if (!today.length) return { kind: 'closed-today' };
  for (const [o, c] of today) {
    const open = toMin(o), close = toMin(c);
    const overnight = close <= open;
    if (now.minutes >= open && (overnight || now.minutes < close)) return { kind: 'open', until: c };
  }
  const next = today.find(([o]) => toMin(o) > now.minutes);
  return next ? { kind: 'opens-later', at: next[0] } : { kind: 'closed-today' };
}

/** "00:00"–"24:00" in the data means open all day (e.g. Campus Safety). */
export const isAllDay = (range: [string, string]) => range[0] === '00:00' && range[1] === '24:00';

export function todayText(hours: Hours | null, now = londonNow()): string {
  const today = hours?.[now.day];
  if (!hours || !today) return 'Today: hours not listed';
  if (!today.length) return 'Today: closed';
  if (today.some(isAllDay)) return 'Today: open 24 hours';
  return 'Today: ' + today.map(([o, c]) => `${o}–${c}`).join(', ');
}
