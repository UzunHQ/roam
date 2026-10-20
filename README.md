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
data/unmatched.txt     places the snapping could not match by name; check these
scripts/build-campus.mjs   Overpass → campus.geojson, snaps places to footprints
src/config.ts          author, Instagram/LinkedIn, report e-mail, analytics
src/main.ts            UI: markers, sheet, search, filters, location, deep links
src/map.ts             MapLibre style: extrusions, roofs, low-poly trees, colours
src/search.ts          fuzzy search (names, codes, aliases, room codes)
src/hours.ts           open/closed in Europe/London time
src/route.ts           "Show me the way" (straight line today, footpath routing later)
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

**Rebuild the map data** (only when OSM changes or you edit positions a lot):

```bash
npm run build:campus           # downloads from Overpass once, re-snaps, rewrites footprintId
npm run build:campus -- --cache  # re-snap using the last download
```

The script prints each match. Anything it couldn't match by name goes to `data/unmatched.txt`. Note that it overwrites `footprintId` values you set by hand. The app never calls Overpass itself.

## Add photos

1. Take a landscape photo of the entrance. Name it after the place id, e.g. `photos-src/library.jpg`.
2. Run `npm run photos`. This writes `public/photos/library.webp` (1200×675, about 100 KB).
3. Set `"photo": "photos/library.webp"` in `data/places.json`.

Photos lazy-load when a card opens and are cached for offline use.

## Configure

Edit `src/config.ts`:

- `links.instagram`, `links.linkedin`: footer icons
- `reportEmail`: where "Report a mistake" sends mail (the place name and id are prefilled)
- `analytics.umamiWebsiteId`: [Umami](https://umami.is) is cookieless. It records page views and the events `place-tap`, `search` (query text and picked place) and `install`. Location is never sent. Leave it empty to turn analytics off.

## Deploy

Static hosting over HTTPS. Build command `npm run build`, output folder `dist`.

- **Vercel:** `npx vercel` (first time), then `npx vercel --prod`. Or import the Git repo at vercel.com. It detects Vite on its own.
- **Netlify:** `npx netlify deploy --build` then `--prod`. Or connect the repo (build `npm run build`, publish `dist`).

There's no routing config to set up: deep links use a query string (`/?place=…`), so every URL is just `/`.

## QR codes for posters

Each place has a link `https://<your-domain>/?place=<id>`, e.g. `https://roam.example.app/?place=library`. That opens the map with the card already showing.

```bash
npx qrcode -o library.png -w 1024 "https://<your-domain>/?place=library"
npx qrcode -t svg -o library.svg "https://<your-domain>/?place=library"   # sharp for print
```

Print at least 3 cm wide and test with both iPhone and Android cameras.

## Privacy

Roam only asks for location after you tap **Find me**. Your position is used on the device only, to draw the avatar and the route. The compass works the same way (on iOS it asks from your tap). No cookies, no accounts.
