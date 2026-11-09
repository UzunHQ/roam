# Roam: developer notes

How to run, edit and deploy Roam. For what Roam is and why I built it, see the [main README](../README.md).

An unofficial, game-style campus map for the University of Roehampton (Roehampton Lane site: Digby Stuart, Froebel, Southlands). It's an installable PWA built with Vite, TypeScript and MapLibre GL. It draws only our own GeoJSON: no map tiles, no satellite imagery, no backend.

> Unofficial student project - not affiliated with the University of Roehampton. Map data © OpenStreetMap contributors (ODbL).

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173 (this computer only)
npm run dev:phone    # also on the LAN URL Vite prints; only on a network you trust
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/ (service worker and offline only work in a build); preview:phone for the LAN
```

GPS and the compass need HTTPS on a real phone. `localhost` is fine on your computer. To test on a phone, deploy a preview (see below) or use a tunnel.

**Coordinate picker (dev only):** with `npm run dev` running, open `/picker.html`. Click the map and `[lng, lat]` is copied to your clipboard. Clicking a building also shows its OSM footprint id. Orange dots are pending places. The picker isn't included in the production build.

## Project layout

```
data/places.json       places (you edit this)
data/campus.geojson    footprints, paths, green areas, water, trees (generated, committed)
data/paths.json        walking graph for directions (generated from OSM, committed)
data/walls.geojson     the campus wall: its line, piers, pillars and gates (generated from OSM, committed)
data/unmatched.txt     places the snapping could not match by name; check these
scripts/build-campus.mjs   Overpass → campus.geojson, snaps places to footprints
scripts/build-context.mjs  adds the surroundings to campus.geojson (see below)
src/config.ts          author, LinkedIn/GitHub, report e-mail, analytics
src/main.ts            UI: markers, sheet, search, filters, location, deep links
src/map.ts             MapLibre style: extrusions, roofs, low-poly trees, colours
src/search.ts          fuzzy search (names, codes, aliases, room codes)
src/data/hours.ts      opening hours: one entry per place and period, with source and check date
src/hours.ts           open/closed in Europe/London time, live Library hours from LibCal
src/route.ts           walking directions: shortest route over data/paths.json
src/categories.ts      user-facing categories (derived from category + kind)
public/                manifest, icons, photos
```

## Edit places.json

Each place keeps the shape below. Only change what you've checked.

| field | notes |
|---|---|
| `status` | `"pending-legend"` hides the place. Set it to `"confirmed"` once the name is known. |
| `name`, `code`, `aliases` | all searchable, with typo tolerance |
| `roomCodePrefixes` | e.g. `["Ma"]`, so timetable room `Ma101` opens Mandela Building. Never guess these. |
| `position` | `[lng, lat]`, the building point (use the picker) |
| `entrance` | `[lng, lat]` of the door. "Show me the way" walks here. Until it's set, it walks to `position`. |
| `lastVerified` | `"2026-10-20"`. Shows as "Last checked 20 Oct 2026" on the card. |
| `photo` | `"photos/<id>.webp"` (see below) |
| `footprintId` | filled in by the build script; you can override it with an id from the picker |
| `officialUrl` | the official page shown as "Official page" on the card |
| `services` | short list of what's there, from official sources (searchable; first four shown, then "+n more") |
| `tags` | facilities found on official pages ("printers (ground and first floor)", "gender-neutral toilets"): searchable and shown as "Also here"; add the page to `sources` |
| `offCampus` | `true` for places outside the map's walking network (a shop across the road): no walking route beyond the nearest gate. Bus stops on Roehampton Lane are inside the map and don't set it |
| `bus` | TfL bus stops: `{ atco, letter, direction, towards, routes, checked }` from TfL's StopPoint API (`https://api.tfl.gov.uk/StopPoint/<atco>`); the card links to `https://tfl.gov.uk/bus/stop/<atco>/` for live times. Re-check routes when TfL changes them |
| `entrances`, `rooms` | checked doors and room details, see Directions; empty until verified |
| `accessibility` | `{ "url", "summary" }`, a link to an access guide (currently AccessAble) |
| `sources` | `[{ "url", "title", "checked": "2026-10-20" }]`. The first one is shown on the card. Keep these up to date. |

Categories on the map (Academic, Library, Food & drink, Halls, Sport, Services, Faith) come from `category` + `kind` in `src/categories.ts`. Empty categories are hidden automatically.

**Rebuild the map data** (only when OSM changes or you edit positions a lot):

```bash
npm run build:campus           # downloads from Overpass once, re-snaps, rewrites footprintId
npm run build:campus -- --cache  # re-snap using the last download
```

Chadwick Hall's paths, wall openings and car area aren't in OSM: they live in `scripts/chadwick.mjs`, which `build:campus`, `build:paths` and `build:walls` all read. `build-campus` draws only the university's buildings (and a building a place points at, like the hospital's main one). `scripts/build-context.mjs` (run by `build:campus`, or alone with `npm run build:context`, which downloads its own wider Overpass extract to `scripts/.overpass-context-cache.json`) then fits the surroundings to one rule, set at the top of the script:
- **The context zone** = the campus (inside the map's edge, west of Roehampton Lane, north of Clarence Lane) + Chadwick Hall's plot + the front of Queen Mary's Hospital's site (west of `HOSPITAL_MAX_X`) + a corridor `CONTEXT_BUFFER_M` (50 m) either side of Roehampton Lane (`LANE_Y`: Chadwick Hall's south end to Southlands' north wall) and of Clarence Lane (`CLARENCE_X`, to the campus's south-west corner; the Alton estate's long blocks of flats, longer than `LONG_BLOCK_M`, stay out). Nothing north of the campus's north edge (`NORTH_LINE`), so the zone ends straight there, and nothing south of Clarence Lane west of Froebel's south-west corner (the Alton estate). Plus the plots in `PARCELS`, drawn whole from their OSM outline (layer `lot`): Roehampton House's estate east of Roehampton Lane (cut straight at Mendez Way), and the Eastwood Nursery and Mosaic Jewish Primary School grounds south of Chadwick Hall, with every building wholly inside them (at most `PARCEL_MAX_HEIGHT`, 7 m), their roads and trees. The app's camera limit and the home view take them in.
- Inside it: OSM's buildings in the plain context style, only the first row along each road (nearest corner within `FRONT_M`, 25 m, of the centre line and middle within the corridor); Ibstock Place School's buildings inside the campus; the hospital's main building, its front part only (one clean block, no light wells), and its car park (OSM's, with painted bays and parked cars drawn along OSM's parking aisles); OSM's roads, footpaths and grass in the zone; where a road's first row is empty, a row of low generated houses (`HOUSE_ROWS`, `generated: true`); street trees in rows along Roehampton Lane, round Chadwick Hall and scattered on open ground (`generated: true`); the Playing Field's running track. `LOW_HEIGHT` sets heights OSM doesn't give (Eastwood Nursery School, single storey).
- Outside it: nothing. Trees, paths and buildings there are removed from campus.geojson, and the zone's outline (layer `contextzone`) is the hole in the app's plain background frame, whose edge fades out (`zone-fade` in src/map.ts).
Everything it adds is marked `context: true`, so a rerun replaces it.

Since round 3 the zone also takes in Roehampton Lane south from Chadwick Hall to the Danebury Avenue junction (`LANE_Y`, and no further east than `LANE_MAX_X`: its run towards Roehampton High Street stays out), Danebury Avenue past the shops (`DANEBURY_X`), Allbrook House with Roehampton Library and its car park and the block over the shops (`LIBRARY_SITE`, kept whole), and Whitelands College's whole plot (`WHITELANDS`, OSM way/269315444, plus `WL_PAD_M`), with its buildings (`college: 'whitelands'`), grounds, paths and a wall drawn on its outline. Tall Alton estate blocks (`TALL_LEVELS`) stay out. It then writes the **focus** ground (layer `campusground`): one ring each for the campus (its wall, closed along the lanes by `MAIN_CLOSE`), Chadwick Hall's plot and Whitelands. The app paints those rings green; everything else is neutral ground. Trees, paths, grass, water, parking and plots whose middle falls outside the focus rings get `ctx: true`, so src/map.ts draws them in the calm surroundings colours.

**Colours** all live in `src/theme/mapColors.ts`, in three levels: focus (the colleges and Chadwick Hall: green ground, bright trees, a roof colour per college), key surroundings (the hospital: off-white building, red edge and H; bus stops; shops; the hospital car park) and background surroundings (warm grey ground, plain buildings, white roads, pale sage trees). Light and dark are both there; `cssVars()` sets the UI's college swatches from the same tokens, so switching System/Light/Dark repaints the map and the UI at once without a reload. Background pins (other nearby places) are smaller and fainter (`k-ctx`) and only get a name from zoom 17.5.

**Opening view and ⛶:** the app opens on the main campus (Southlands, Digby Stuart, Froebel and Chadwick Hall: `mainPoints` in main.ts), tilted 45° on a phone and 55° on a wide screen. ⛶ shows the main campus; pressed again where that left you, the whole island (Whitelands too). Tapping a college's name flies there. minZoom (13.5) stays a full step below the phone's opening zoom, so − always works there.

**Pins:** below zoom 17 with no category chosen, only the library, food, student services, nearby places and gates have pins (`MID_GROUPS`); teaching buildings, halls, sport and the rest join from 17. A place with `noPin: true` (Whitelands College) is a search record only; `outsideMap: true` (Little Waitrose) says so on its card and on a route.

**Camera limit:** instead of a `maxBounds` box, `islandConstrain` in src/map.ts (MapLibre's `transformConstrain`) keeps the camera's centre inside the island's outline (layer `contextzone`) or within `ISLAND_PAD_M` (120 m) of it. It measures from the outline, so the island's empty diagonal corners can't be reached, never forces a zoom-in on a wide screen, and works the same turned and tilted.

After rebuilding, also run `npm run build:paths` to refresh the walking graph, and `npm run build:walls` to refresh the campus wall. The campus wall is one continuous line (plus a separate ring round Chadwick Hall's plot): the university boundary along Roehampton Lane, then the `barrier=wall` ways along Clarence Lane. It opens only at entrances: a garden gate at each named one (the entrances in `places.json` and named OSM gates), a closed iron gate at other OSM gates, and a doorway at `entrance=*` doors on the line. Where a building stands on the line, the wall runs round its street side. The script prints every opening and why it is there.

The script prints each match. Anything it couldn't match by name goes to `data/unmatched.txt`. Note that it overwrites `footprintId` values you set by hand. The app never calls Overpass itself.

## Opening hours

All hours live in `src/data/hours.ts`: weekly hours, the period they apply to (`from`/`to`), the source and the date you checked them. Only use the official source: LibCal for the Library, a Nest screenshot for cafés and everything else. Never Google or AI summaries, never a guess. A place with no entry shows no hours at all.

- The Library is read live from LibCal's public hours feed (cached for 6 hours on the phone). Its entry in `hours.ts` is only the fallback when LibCal can't be reached.
- Typed-in hours stop showing "Open now" once they were checked more than 30 days ago or their period is over: the card says "Hours may have changed" instead.
- The "Open now" switch (Food and Study) only counts places with listed hours.

## Add photos

1. Take a landscape photo of the entrance. Name it after the place id, e.g. `photos-src/library.jpg`.
2. Run `npm run photos`. This writes `public/photos/library.webp` (1200×675, about 100 KB).
3. Set `"photo": "photos/library.webp"` in `data/places.json`.

Photos lazy-load when a card opens and are cached for offline use.

Unverified data and gaps are listed in [TODO-data.md](TODO-data.md).

## Directions

"Directions" finds the shortest walk over OSM footpaths, steps and campus roads (`data/paths.json`). Restricted ways (`access=no`, `foot=no`, and private ways outside the university outline) are left out. You choose the starting point: your location (one fix, only when you ask), a campus entrance, or another place.

- Until a place has an entrance, the route ends at the path nearest the building, and the card says so. Add entrances with the picker (`/picker.html`) after checking them on site:

  ```json
  "entrances": [
    { "pos": [-0.24801, 51.45712], "type": "main", "name": "Front door on Digby Square", "verified": true, "source": "Checked on site", "checked": "2026-11-10" },
    { "pos": [-0.24790, 51.45705], "type": "accessible", "verified": false }
  ]
  ```

  `type` is `main`, `accessible`, `card-required` or `closed` (never routed to). When a place has any `verified` entrance, only verified ones are used; otherwise unverified ones are, and the directions say the door hasn't been checked. The old single `entrance` field still works and counts as an unverified main door.
- Directions also come as text steps (heading, turns, distances), worked out from the route line; a turn names a mapped building only when the route passes right by it. Without a map the steps open by themselves.
- The start is a searchable list: My location, Pick on the map, recent starts (kept on this device only), the campus entrances and every place. The ⇅ button swaps start and destination when the start is a place.
- Routes with steps say "Includes steps". There's no step-free option yet: that needs a route checked end to end first, and Roam never labels an unchecked route as step-free.
- Off campus, Roam asks you to start from an entrance instead.

## Configure

Edit `src/config.ts`:

- `links.linkedin`, `links.github`: the icons in the footer and the links in About (empty hides one)
- `reportForm`: the Google Form "Report a mistake" opens, with the place name prefilled (`placeField` is that question's `entry.` id)
- `reportEmail`: used instead when `reportForm.url` is empty
- `analytics.umamiWebsiteId`: [Umami](https://umami.is) is cookieless. It records page views and the events `place-tap`, `search` (query text and picked place) and `install`. Location is never sent. Leave it empty to turn analytics off.

## Deploy

Static hosting over HTTPS. Build command `npm run build`, output folder `dist`.

- **Vercel:** `npx vercel` (first time), then `npx vercel --prod`. Or import the Git repo at vercel.com. It detects Vite on its own.
- **Netlify:** `npx netlify deploy --build` then `--prod`. Or connect the repo (build `npm run build`, publish `dist`).

There's no routing config to set up: deep links use a query string (`/?place=…`), so every URL is just `/`.

`vercel.json` makes sure `sw.js` is never cached by the browser (so updates reach phones) and that hashed assets are cached for a year. It also sets the security headers (Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, HSTS, Permissions-Policy). If you turn on Umami analytics, its hosts are already allowed in the CSP; any other new outside script or API has to be added there too, or the browser will block it.

## QR codes for posters

Each place has a link `https://<your-domain>/?place=<id>`, e.g. `https://roam.example.app/?place=library`. That opens the map with the card already showing.

```bash
npx qrcode -o library.png -w 1024 "https://<your-domain>/?place=library"
npx qrcode -t svg -o library.svg "https://<your-domain>/?place=library"   # sharp for print
```

Use your confirmed production address. Don't generate final codes from a preview URL. A general QR code (just the domain) opens the whole campus. A place QR code skips the welcome card and opens that building.

Print at least 3 cm wide and test with both iPhone and Android cameras.

## Privacy

Roam only asks for location after you tap **Find me**. Your position is used on the device only, to draw the avatar and the route. The compass works the same way (on iOS it asks from your tap). No cookies, no accounts.

## Branding

The app uses a plain text title. The university's website terms and visual identity guidelines don't allow third parties to reuse the official logo without consent. If you want to use it, ask the university's communications team for permission first, then use their supplied file unchanged.
