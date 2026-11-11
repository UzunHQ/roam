// Writes the doors the owner marked (docs/doors/<date>-owner-marks.json) into data/places.json as
// `entrances`. They are main doors, marked from memory on the map: verified stays false until a
// check on site. A place that shares a building takes the doors of the place it names ("same"),
// or just the ones listed under "doorsUsed" (Costa's own door, the shop's).
// usage: node scripts/apply-doors.mjs docs/doors/2026-11-11-owner-marks.json
import { readFile, writeFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-doors.mjs <marks.json>'); process.exit(1); }
const marks = JSON.parse(await readFile(file, 'utf8'));
const checked = /(\d{4}-\d{2}-\d{2})/.exec(file)?.[1];
if (!checked) { console.error('the file name needs its date (YYYY-MM-DD)'); process.exit(1); }
const path = new URL('../data/places.json', import.meta.url);
const doc = JSON.parse(await readFile(path, 'utf8'));
const byId = new Map(doc.places.map((p) => [p.id, p]));
const SOURCE = 'Marked on the map by the owner, from memory';

// the Library's two doors face each other (owner's note): one latitude for both
const doors = structuredClone(marks.doors);
if (doors.library?.length === 2) { const lat = +((doors.library[0][1] + doors.library[1][1]) / 2).toFixed(6); doors.library.forEach((d) => (d[1] = lat)); }

const entrancesOf = (id, only) => (doors[id] ?? []).map((pos, i) => ({ pos, type: 'main', ...(marks.doorNames?.[id]?.[i] ? { name: marks.doorNames[id][i] } : {}), verified: false, source: SOURCE, checked })).filter((_, i) => !only || only.includes(i));

let n = 0, places = 0;
const set = (id, list) => {
  const p = byId.get(id);
  if (!p) throw new Error(`no place "${id}"`);
  if (!list.length) return;
  // a door checked on site is never replaced by one marked from memory
  if ((p.entrances ?? []).some((e) => e.verified)) { console.log(`kept the checked door(s) of ${id}`); return; }
  p.entrances = list;
  n += list.length; places++;
};
for (const id of Object.keys(doors)) set(id, entrancesOf(id));
for (const [id, from] of Object.entries(marks.same ?? {})) set(id, entrancesOf(from, marks.doorsUsed?.[id]));
await writeFile(path, JSON.stringify(doc, null, 2) + '\n');
console.log(`${n} doors on ${places} places; not marked: ${[...(marks.skip ?? []), ...Object.entries(marks.same ?? {}).filter(([, from]) => !doors[from]).map(([id]) => id)].join(', ')}`);
