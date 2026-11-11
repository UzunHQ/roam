// Live bus times for a stop, from Transport for London's open data (the Unified API's arrival
// predictions). Asked straight from the phone, and only while a bus stop's card is open: Roam has
// no server of its own. Licence: TfL's Transport Data Service terms ("Powered by TfL Open Data").

/** one bus on its way to the stop */
export interface Arrival {
  line: string; // "265", "N74"
  to: string; // where it ends up: "Putney Bridge"
  due: number; // when it's expected at the stop (ms since 1970)
}

/** a route's next few buses, as the card shows them */
export interface LineTimes {
  line: string;
  to: string;
  due: number[]; // soonest first
}

const HOUR = 3_600_000;

/**
 * TfL's answer for one stop → the buses still to come, soonest first. Anything malformed, already
 * gone (more than half a minute ago) or implausibly far off is left out; an answer that isn't a
 * list at all is an error (TfL sends an object when the stop id is wrong).
 */
export function parseArrivals(json: unknown, now: number): Arrival[] {
  if (!Array.isArray(json)) throw new Error('TfL: not a list of arrivals');
  const out: Arrival[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const line = typeof r.lineName === 'string' ? r.lineName.trim() : '';
    const to = typeof r.destinationName === 'string' ? r.destinationName.trim() : '';
    const at = typeof r.expectedArrival === 'string' ? Date.parse(r.expectedArrival) : NaN;
    // (the clock time first; "seconds to the stop" is as of when TfL answered, so it ages)
    const due = Number.isFinite(at) ? at : typeof r.timeToStation === 'number' && Number.isFinite(r.timeToStation) ? now + r.timeToStation * 1000 : NaN;
    if (!line || !Number.isFinite(due) || due < now - 30_000 || due > now + 2 * HOUR) continue;
    out.push({ line, to, due });
  }
  return out.sort((a, b) => a.due - b.due || a.line.localeCompare(b.line));
}

/** the buses by route and destination, each with its next `perLine` times; the route due first comes first */
export function byLine(arrivals: Arrival[], now: number, perLine = 3): LineTimes[] {
  const groups = new Map<string, LineTimes>();
  for (const a of arrivals) {
    if (a.due < now - 30_000) continue; // gone since the list was fetched
    const key = `${a.line}|${a.to}`;
    const g = groups.get(key) ?? { line: a.line, to: a.to, due: [] };
    if (g.due.length < perLine) g.due.push(a.due);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.due[0] - b.due[0] || a.line.localeCompare(b.line, undefined, { numeric: true }));
}

/** whole minutes until a bus is due, the way a bus stop's sign counts: under a minute is "due" (0) */
export const minutesUntil = (due: number, now: number) => Math.max(0, Math.floor((due - now) / 60_000));

/** the buses expected at a stop (its ATCO/NaPTAN code). Rejects when TfL can't be reached or answers oddly. */
export async function fetchArrivals(atco: string, timeoutMs = 8000): Promise<Arrival[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(atco)}/Arrivals`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`TfL ${res.status}`);
    return parseArrivals(await res.json(), Date.now());
  } finally {
    clearTimeout(timer);
  }
}
