You are a senior front-end engineer with a game-UI eye, working in an empty project folder on my Mac through Claude Code. Build "Roam": an unofficial, game-style campus map web app (PWA) for the University of Roehampton, London.

CONTEXT
New students get lost. The official campus map is a September 2025 PDF and parts of campus have changed since. Catering hours sit behind a student login. Roam opens from a link or QR code, shows a simplified bird's-eye 3D campus that feels like a mobile game, shows where you are via GPS, and lets you tap a building, cafe or sports facility to see a small info card. For campus questions it must be faster and clearer than Google Maps.

SCOPE (v1)
Include:
- One site only: the Roehampton Lane Site (Digby Stuart, Froebel, Southlands colleges). Lock map bounds to "bounds" in data/places.json.
- Three categories: Buildings, Food, Sport.
- Live GPS position as a small avatar with an accuracy ring; heading arrow when available.
- Tap a place -> bottom sheet: name, short code, category icon, 1-2 line description, open/closed badge with today's hours, entrance photo, "Show me the way" button, "Report a mistake" link.
- Search by official name, short code, aliases and timetable room code (room code resolves to its building). Typo-tolerant.
- Filter chips: All / Buildings / Food / Sport. Entrances (category "entrance") show as small gate markers, not a filter.
- "Show me the way": a line from the user to the place's entrance, plus distance and walking minutes. Keep the data model ready for footpath routing later.
- Installable PWA: manifest, icons, service worker, offline cache of app shell, data and photos.
- Footer: "Made by Hüseyin" + two small icon links (Instagram and LinkedIn, URLs in one config file); "Unofficial student project - not affiliated with the University of Roehampton"; "(c) OpenStreetMap contributors".
Exclude: indoor maps (rooms, floors), accounts/login, push notifications, badges/quests, app store builds.

TECH
- Vite + TypeScript. No heavy framework unless clearly needed.
- MapLibre GL JS rendering only our own GeoJSON on a plain background: no third-party tiles, no satellite imagery. Buildings as fill-extrusion, pitched camera (about 50-60 degrees), maxBounds on campus.
- Data: data/places.json (already in this folder) and data/campus.geojson (footprints, paths, green areas, water). Build campus.geojson once from OpenStreetMap with the Overpass API for the places.json bounds and commit it; the app never calls Overpass at runtime.
- Static hosting over HTTPS (Vercel or Netlify). No backend.
- Location never leaves the device. Cookieless analytics only (Cloudflare Web Analytics or Umami): page views, installs, place taps, top searches.

DATA MODEL (data/places.json; keep its shape)
{
  "id": "mandela-building",
  "code": "D1",                      // code on the official campus map
  "name": "Mandela Building",
  "aliases": ["Mandela", "Law School"],
  "roomCodePrefixes": ["Ma"],
  "category": "building | food | sport | entrance",
  "kind": "academic | accommodation | service | faith | cafe | gym | court | entrance ...",
  "college": "digby-stuart | froebel | southlands | null",
  "description": "Law School",
  "position": [lng, lat],            // approximate building point
  "positionSource": "google-maps | official-map",
  "positionAccuracyM": 6,
  "entrance": null,                  // [lng, lat] once picked; routing falls back to position
  "footprintId": null,
  "hours": null,                     // e.g. { "mon": [["06:00", "22:00"]], "notes": "..." }
  "photo": null,
  "lastVerified": null,
  "status": "confirmed | pending-legend"
}
- Compute "open now" on the device in Europe/London time and show "Last checked {date}".
- Positions are approximate (5-40 m, see positionAccuracyM). Snap each place to the OSM footprint with a matching name, else the nearest one, and give me a list of places you could not match.
- Hide places with status "pending-legend". Never invent opening hours or room codes.

LOOK AND FEEL
- Cute low-poly mobile-game style: soft pastel palette, chunky extruded blocks with darker roofs, simple low-poly trees, rounded UI, playful but readable.
- Each college zone uses the official map colours: Digby Stuart light blue, Froebel yellow, Southlands navy.
- Tap targets at least 44 px. Light and dark mode.
- Bottom sheet opens in under 200 ms. Small touches (building bounce on tap, avatar bob) never block use. No long intro animation.

EDGE CASES
- Ask for location only after the user taps "Find me", with a one-line reason. If denied, the map still works.
- iOS: request compass permission from a user tap; if refused, hide the heading arrow.
- Accuracy worse than 50 m -> show "GPS is weak here".
- User off campus -> "You're not on campus yet" + distance to campus.
- Deep link /?place=<id> opens that card (for QR codes on posters).
- First load under 2 s on 4G. Photos as compressed WebP, lazy-loaded.

DELIVERABLES
1. First reply with the file structure and your map approach in 5 bullets, then build.
2. A working app using data/places.json and the OSM footprints.
3. A coordinate picker dev page: click the map -> copy [lng, lat].
4. README: run locally, edit places.json, add photos, deploy, make QR codes.
5. Check layouts at iPhone and Android phone sizes.
Ask me before adding anything not listed here.
