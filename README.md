# Roam

An unofficial, game-style campus map for the University of Roehampton (Roehampton Lane site: Digby Stuart, Froebel, Southlands). It's an installable PWA built with Vite, TypeScript and MapLibre GL. It draws only our own GeoJSON: no map tiles, no satellite imagery, no backend.

> Unofficial student project - not affiliated with the University of Roehampton. Map data © OpenStreetMap contributors (ODbL).

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173  (also on your phone via the LAN URL Vite prints)
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/ (service worker and offline only work in a build)
```

GPS and the compass need HTTPS on a real phone. `localhost` is fine on your computer. To test on a phone, deploy a preview (see below) or use a tunnel.

**Coordinate picker (dev only):** with `npm run dev` running, open `/picker.html`. Click the map and `[lng, lat]` is copied to your clipboard. Clicking a building also shows its OSM footprint id. Orange dots are pending places. The picker isn't included in the production build.

## Project layout

```
data/places.json       places (you edit this)
data/campus.geojson    footprints, paths, green areas, water, trees (generated, committed)
data/paths.json        walking graph for directions (generated from OSM, committed)
data/unmatched.txt     places the snapping could not match by name; check these
scripts/build-campus.mjs   Overpass → campus.geojson, snaps places to footprints
src/config.ts          author, Instagram/LinkedIn, report e-mail, analytics
src/main.ts            UI: markers, sheet, search, filters, location, deep links
src/map.ts             MapLibre style: extrusions, roofs, low-poly trees, colours
src/search.ts          fuzzy search (names, codes, aliases, room codes)
src/hours.ts           open/closed in Europe/London time
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
| `hours` | `{ "mon": [["08:00","18:00"]], "sat": [], "notes": "…" }`. A missing day shows "hours not listed". `[]` means closed. Ranges past midnight work (`["20:00","02:00"]`). Never invent hours. |
| `lastVerified` | `"2026-10-20"`. Shows as "Last checked 20 Oct 2026" on the card. |
| `photo` | `"photos/<id>.webp"` (see below) |
| `footprintId` | filled in by the build script; you can override it with an id from the picker |
| `officialUrl` | the official page shown as "Official page" on the card |
| `services` | short list of what's there, from official sources (searchable; first four shown, then "+n more") |
| `accessibility` | `{ "url", "summary" }`, a link to an access guide (currently AccessAble) |
| `sources` | `[{ "url", "title", "checked": "2026-10-20" }]`. The first one is shown on the card. Keep these up to date. |

Categories on the map (Academic, Library, Food & drink, Halls, Sport, Services, Faith) come from `category` + `kind` in `src/categories.ts`. Empty categories are hidden automatically.

**Rebuild the map data** (only when OSM changes or you edit positions a lot):

```bash
npm run build:campus           # downloads from Overpass once, re-snaps, rewrites footprintId
npm run build:campus -- --cache  # re-snap using the last download
```

After rebuilding, also run `npm run build:paths` to refresh the walking graph.

The script prints each match. Anything it couldn't match by name goes to `data/unmatched.txt`. Note that it overwrites `footprintId` values you set by hand. The app never calls Overpass itself.

## Add photos

1. Take a landscape photo of the entrance. Name it after the place id, e.g. `photos-src/library.jpg`.
2. Run `npm run photos`. This writes `public/photos/library.webp` (1200×675, about 100 KB).
3. Set `"photo": "photos/library.webp"` in `data/places.json`.

Photos lazy-load when a card opens and are cached for offline use.

## Directions

"Directions" finds the shortest walk over OSM footpaths, steps and campus roads (`data/paths.json`). Restricted ways (`access=no`, `foot=no`, and private ways outside the university outline) are left out. You choose the starting point: your location (one fix, only when you ask), a campus entrance, or another place.

- Until a place has a verified `entrance`, the route ends at the path nearest the building, and the card says so. Add entrances with the picker to fix this.
- Routes with steps say "Includes steps". There's no step-free option yet: that needs verified path data first.
- Off campus, Roam asks you to start from an entrance instead.

## Configure

Edit `src/config.ts`:

- `links.instagram`, `links.linkedin`: footer icons
- `reportForm`: the Google Form "Report a mistake" opens, with the place name prefilled (`placeField` is that question's `entry.` id)
- `reportEmail`: used instead when `reportForm.url` is empty
- `analytics.umamiWebsiteId`: [Umami](https://umami.is) is cookieless. It records page views and the events `place-tap`, `search` (query text and picked place) and `install`. Location is never sent. Leave it empty to turn analytics off.

## Deploy

Static hosting over HTTPS. Build command `npm run build`, output folder `dist`.

- **Vercel:** `npx vercel` (first time), then `npx vercel --prod`. Or import the Git repo at vercel.com. It detects Vite on its own.
- **Netlify:** `npx netlify deploy --build` then `--prod`. Or connect the repo (build `npm run build`, publish `dist`).

There's no routing config to set up: deep links use a query string (`/?place=…`), so every URL is just `/`.

`vercel.json` makes sure `sw.js` is never cached by the browser (so updates reach phones) and that hashed assets are cached for a year.

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
