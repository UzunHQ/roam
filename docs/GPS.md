# GPS: how the location works, and how to measure it

## What the app does with each reading

`src/geo.ts` asks the phone for readings (`watchPosition`, high accuracy). Each one goes through
`src/gps.ts` (`GpsFilter`), a pure module with no DOM, so `scripts/check-gps.mjs` runs the very same
code in Node:

1. **First position.** A reading worse than 30 m waits up to 4 s for a better one ("Finding you…");
   then the best of them.
2. **Jumps.** A reading that would mean moving faster than 7 m/s, even allowing for its own accuracy
   and the filter's, is dropped. Two in a row the same way (within 45°) are a real move and are kept.
3. **Kalman filter.** Constant velocity, measurement noise = accuracy², plus the phone's own speed
   and course when it gives them.
4. **Standing still.** Under 0.5 m/s and less than half the accuracy from where it stood: the
   character doesn't move, and the filter holds the speed at zero, so it averages the readings
   instead of chasing the noise. It sets off again when the phone reports a speed twice, or when
   the last 5 s of readings have clearly left the spot (3.5 standard errors), three times running.
5. **Display only.**
   - A weak reading (over 20 m) inside a building: the character waits at the building's edge,
     with "Inside …" under it.
   - Otherwise, with a reading of 25 m or better, it stands on the route line while one is shown
     (up to 15 m away), or on the nearest footpath (up to the accuracy, 5–12 m away).
   - It never stands across a building, and it sticks to the path it is on until another is 3 m
     nearer.
   - It moves at most 12 m per reading, catching up over the next ones.
6. **Heading.** Above 1 m/s, the GPS course; slower, the compass.
7. **Weak GPS** (over 50 m, `config.weakGpsM`): the character is faint. The accuracy ring and the
   "GPS is weak here" note stay.

Off-route checks (`onNavFix`) and arrival use the **filtered** position, never the one moved onto a
path. Arrival also needs a decent reading within 12 m of the end (or its accuracy, up to 20 m),
twice running.

## Recording a walk

1. Open `https://roam-roehampton.vercel.app/?gpslog&notrack` on the phone. Use the preview link
   while testing a branch.
2. Tap **Find me**, allow location, and walk one of the routes below at a normal pace. Keep the
   phone in your hand, screen on: GPS stops when Roam isn't on screen.
3. At the end, open **Settings** (the gear) → **Download GPS log (GPX + JSON)**. **Delete log**
   before the next walk (it asks twice).
   - The log stays in the phone's browser storage (IndexedDB). It is never sent anywhere.
   - `?gpslog` is remembered until the tab is closed.
4. Put both files in `docs/gps-logs/` as `YYYY-MM-DD-<route>.json`/`.gpx`. Then run
   `npm run gps:report docs/gps-logs/<file>.json`.

What the report says:
- (a) how far the readings, and the character, were from the nearest footpath (median, 90th
  percentile, max);
- (b) the mean lean east/north for each part of the campus. A large, consistent lean (consistency
  near 1) in one place means the map is off there; scatter (near 0) is GPS noise;
- (c) the accuracies the phone reported;
- (d) the share of readings inside buildings.

### The four routes to walk

| # | From → to | Why |
|---|---|---|
| 1 | Chadwick Hall (South) → Froebel (Grove House) | Roehampton Lane's pavement, the Froebel gate, the slope up |
| 2 | Froebel (Grove House) → Library | across the lake path and the Digby Stuart grounds |
| 3 | Digby Stuart (Library) → Southlands | Main entrance side and Roehampton Lane north |
| 4 | Main entrance → Whitelands College | the longest: Roehampton Lane south and into Whitelands |

Walk each one once in each direction if you can; a second phone (another make) helps tell the map
from one phone's GPS.

## Measurements

**No real recordings yet (9 Nov 2026).** Everything below is synthetic: walks along the real
campus paths (`data/paths.json`) with made-up noise (seeded Gaussian, independent each second), from
`npm run check:gps`.
- "Before" is what the app did until now: every raw reading shown as it came, and arrival from a
  single raw reading within max(12 m, accuracy).
- Real GPS noise drifts slowly rather than jumping each second. That is easier for the jump check
  and harder for the standing-still check. Only real logs will tell.

| Case (synthetic) | Before | After | Pass mark |
|---|---|---|---|
| Walking, ±8 m noise: median distance to the path walked | 3.9 m | 0 m | < 3 m |
| … 90th percentile, no speed from the phone | 9.4 m | 6 m | – |
| … median distance from the true position, no speed / with speed | 6.8 / 6.8 m | 2.9 / 1.1 m | – |
| Walking a shown route: median distance to the route | 3.9 m | 0 m | < 3 m |
| Standing 2 min, ±10 m noise: total movement, worst of 50 (on a path / on a lawn) | 1,664 / 1,698 m | 0 / 0 m | < 2 m |
| One reading 200 m off: worst distance from the truth around it | 200 m | 1.5 m | dropped, < 15 m |
| Inside a building, accuracy 35 m: wandering inside | 1,304 m | 0 m ("Inside Library") | < 2 m |
| First reading 40 m, a 8 m one 1.5 s later | 36 m off | 3.2 m | waits, < 10 m |
| Only 40 m readings for 4 s, then 8 m ones | 36 m off | 2 m after 4 s | < 10 m |
| Waiting 40 m (in a straight line) from a route's end, ±10 m noise, 2 min: false arrivals | 6 | 0 | 0 |
| Walking all the way in: arrival | yes | yes | yes |

**The price** (also synthetic): after standing, the character sets off again after a median of
**2 s** when the phone reports its speed (most phones do outdoors). It takes **17 s** when the
phone doesn't and the readings are scattered ±8 m. Real logs will show which phones fall in the
second group.

The smoke test (`npm run test:smoke`) also walks 30 fake readings along a route in a real browser,
using Playwright's geolocation:
- no step of the character is over 15 m;
- it stands on the route line;
- no errors.

Numbers as of 11 Nov 2026, after the routes began to end at the doors the owner marked: the test
walks now leave the mapped path for the last few metres to a door, which is why the 90th percentile
without the phone's speed is 6 m (it was 2.5 m when routes ended on the path).

- A route that doubles back by a door can put two positions a step apart much further apart on
  the line. The character then goes one step (12 m) towards the spot and stands on the line
  there (`noLeap`), so it still never leaps.

### Real measurements

| Date | Phone | Route | (a) raw median / p90 | (a) character median / p90 | (b) consistent lean | (c) accuracy median | (d) inside buildings |
|---|---|---|---|---|---|---|---|
| – | – | – | – | – | – | – | – |
