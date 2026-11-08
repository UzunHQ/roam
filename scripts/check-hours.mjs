// Checks the opening-hours logic (src/hours.ts) on the awkward cases: clock changes, hours past
// midnight, days with no listed hours, out-of-date hours and holiday exceptions.
// Run: node scripts/check-hours.mjs   (exits 1 on any failure)
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'roam-hours-'));
const out = join(dir, 'hours.mjs');
await build({
  stdin: { contents: "export * from './src/hours.ts'; export { HOURS } from './src/data/hours.ts';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
});
const H = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const at = (iso) => H.londonNow(new Date(iso));
const hm = (n) => `${String(Math.floor(n.minutes / 60)).padStart(2, '0')}:${String(n.minutes % 60).padStart(2, '0')}`;

// Europe/London clock changes (2026: forward 29 Mar 01:00 GMT, back 25 Oct 01:00 GMT)
eq('GMT before spring change', [at('2026-03-29T00:30:00Z').date, hm(at('2026-03-29T00:30:00Z'))], ['2026-03-29', '00:30']);
eq('BST after spring change', hm(at('2026-03-29T01:30:00Z')), '02:30');
eq('BST before autumn change', hm(at('2026-10-25T00:30:00Z')), '01:30');
eq('GMT after autumn change', hm(at('2026-10-25T01:30:00Z')), '01:30');
eq('summer evening is BST', hm(at('2026-07-01T21:30:00Z')), '22:30');
eq('London date rolls over at local midnight', at('2026-07-01T23:30:00Z').date, '2026-07-02');

// a synthetic place: Fri 20:00-02:00, Sat closed, Sun not listed, weekdays 09:00-17:00
const weekly = { mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['20:00', '02:00']], sat: [] };
const dayOf = (d) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(d + 'T00:00:00Z').getUTCDay()];
const resolved = (extra = {}) => ({ on: (d) => weekly[dayOf(d)], checked: '2026-11-01', live: false, stale: false, ...extra });
// 2026-11-06 is a Friday (GMT)
eq('past midnight: Sat 01:00 still open, closes 02:00', H.openState(resolved(), at('2026-11-07T01:00:00Z')).closes, '02:00');
eq('past midnight: kind open', H.openState(resolved(), at('2026-11-07T01:00:00Z')).kind, 'open');
eq('Fri 19:00 closed, opens 20:00 in 60 min', (({ kind, opens, inMin }) => ({ kind, opens, inMin }))(H.openState(resolved(), at('2026-11-06T19:00:00Z'))), { kind: 'closed', opens: '20:00', inMin: 60 });
eq('closing soon at 01:45', H.openState(resolved(), at('2026-11-07T01:45:00Z')).soon, true);
eq('Sat 12:00 closed; Sun not listed so no "opens"', H.openState(resolved(), at('2026-11-07T12:00:00Z')).opens, null);
eq('Sun (not listed) is unknown, never open', H.openState(resolved(), at('2026-11-08T12:00:00Z')).kind, 'unknown');
eq('stale hours say stale', H.openState(resolved({ stale: true }), at('2026-11-04T10:00:00Z')).kind, 'stale');
eq('Mon 08:00 closed, opens in 60', H.openState(resolved(), at('2026-11-09T08:00:00Z')).inMin, 60);
eq('Wed 16:00 open, 60 min left', H.openState(resolved(), at('2026-11-11T16:00:00Z')).leftMin, 60);

// typed-in entries from src/data/hours.ts
eq('a place with no entry has no hours', H.resolveHours('no-such-place', at('2026-11-04T10:00:00Z')), null);
const library = H.resolveHours('library', at('2026-11-04T10:00:00Z')); // fallback entry (no LibCal in node)
eq('library fallback Wed 10:00 open', H.openState(library, at('2026-11-04T10:00:00Z')).kind, library.stale ? 'stale' : 'open');
const diner = H.resolveHours('froebel-diner', at('2026-11-07T12:00:00Z'));
eq('Froebel Diner Saturday closed', diner && H.openState(diner, at('2026-11-07T12:00:00Z')).kind, diner?.stale ? 'stale' : 'closed');
const digby = H.resolveHours('digby-den-diner', at('2026-11-04T12:00:00Z'));
eq('Digby Den (no verified hours) is unknown', digby && H.openState(digby, at('2026-11-04T12:00:00Z')).kind, digby?.stale ? 'stale' : 'unknown');

// holiday exceptions beat the usual week
H.HOURS.push({
  place: 'test-cafe', period: 'Term', from: '2026-11-01', checked: '2026-12-01', weekly: { mon: [['09:00', '17:00']], tue: [['09:00', '17:00']] },
  exceptions: [{ from: '2026-12-21', to: '2026-12-22', label: 'Closed for the holidays', closed: true }, { from: '2026-11-24', to: '2026-11-24', label: 'Short day', weekly: { tue: [['09:00', '12:00']] } }],
});
const xmas = H.resolveHours('test-cafe', at('2026-12-21T10:00:00Z'));
eq('exception: closed on 21 Dec (a Monday)', H.openState(xmas, at('2026-12-21T10:00:00Z')).kind, 'closed');
eq('exception: its label is shown', xmas.notes, 'Closed for the holidays');
const short = H.resolveHours('test-cafe', at('2026-11-24T13:00:00Z'));
eq('exception: short day closed at 13:00', H.openState(short, at('2026-11-24T13:00:00Z')).kind, 'closed');
eq('normal Tuesday open at 13:00', H.openState(H.resolveHours('test-cafe', at('2026-11-17T13:00:00Z')), at('2026-11-17T13:00:00Z')).kind, 'open');

process.exitCode = failed ? 1 : 0;
console.log(failed ? `\n${failed} failed` : '\nall passed');
