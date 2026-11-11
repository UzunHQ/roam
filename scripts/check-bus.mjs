// Live bus times (src/bus.ts): TfL's answer for a stop, read the way the app reads it. The fixture
// has the shape of a real answer (field names from api.tfl.gov.uk/StopPoint/<id>/Arrivals, checked
// 11 Nov 2026); its buses and times are made up, with a few broken rows on purpose.
// usage: node scripts/check-bus.mjs   (exits 1 on any failure)
import { readFile } from 'node:fs/promises';
import { loadTs } from './lib/load-ts.mjs';

const { parseArrivals, byLine, minutesUntil } = await loadTs('../../src/bus.ts');
const fixture = JSON.parse(await readFile(new URL('./fixtures/tfl-arrivals.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-11-11T07:00:00Z');
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

const all = parseArrivals(fixture, now);
check('broken rows are left out: no route name, a bad date with no countdown, a bus long gone, junk', all.length === 7, `${all.length} buses`);
check('soonest first', all.every((a, i) => !i || all[i - 1].due <= a.due) && all[0].line === '493');
check('the clock time is used when given', all.find((a) => a.line === '419').due === Date.parse('2026-11-11T07:08:00Z'));
check('with no clock time, the countdown is used', all.find((a) => a.line === 'N74').due === now + 700_000);

const rows = byLine(all, now);
check('one row a route and destination, the route due first on top', rows.map((r) => r.line).join(',') === '493,265,419,N74', rows.map((r) => r.line).join(','));
check('at most three times a route', rows.find((r) => r.line === '265').due.length === 3);
check('minutes count down like a bus stop sign', minutesUntil(now + 30_000, now) === 0 && minutesUntil(now + 190_000, now) === 3 && minutesUntil(now - 5000, now) === 0);
// two minutes on, the 493 has gone: it leaves the list without asking TfL again
check('a bus that has gone leaves the list', byLine(all, now + 120_000)[0].line === '265');
let threw = false;
try { parseArrivals({ httpStatusCode: 404, message: 'The following stop point is not recognised' }, now); } catch { threw = true; }
check("an answer that isn't a list is an error (a wrong stop id)", threw);
check('an empty list is fine: no buses due', parseArrivals([], now).length === 0);

console.log(failed ? `check:bus: ${failed} failed` : 'check:bus: all passed');
process.exit(failed ? 1 : 0);
