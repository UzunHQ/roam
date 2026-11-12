# Data still to verify

Roam only shows what has a source. Everything below is missing or unverified, with where to check it.
Last reviewed: 9 Nov 2026.

## Entrances (no place has any yet)

Every route ends "on the path nearest the building". To fix: walk the campus, pick each door with
`/picker.html` and add `entrances` to `data/places.json` (format in `docs/DEVELOPMENT.md`, Directions).
Mark `type` (`main`, `accessible`, `card-required`, `closed`) and `verified: true` only for doors checked on site.

- [ ] Main doors of the teaching buildings: Mandela, Sir David Bell, Fincham, Howard, Dorothy Buchanan, Mary Seacole, Queen's Building, Lawrence, Michaelis, Grove House, Jebb Auditorium, Lulham, Gilroy, Brearley
- [ ] Library (main door and the step-free entrance)
- [ ] Food places inside other buildings: Costa, Froebel Diner, Union Bar, Pub & Grub (Montefiore); Library Café; Quad Café
- [ ] Which doors need a card, and which are closed out of hours
- [ ] Halls: every block's door (Chadwick Hall's three buildings included)
- [ ] Chadwick Hall's doors: South's from a resident's sketch (north side, near the east end), North's and West's marked by the owner from memory (11 Nov 2026). All `verified: false`.

## Rooms

- [ ] Floors and ways in for timetable rooms (`rooms` in places.json). Today only the building is known from the room-code prefix.
- [ ] Room-code prefixes for buildings that have none yet (e.g. Elm Grove, Erasmus House, Lawrence's rooms if not "La").

## Step-free routes

- [ ] Paths checked end to end for steps, kerbs and slopes. Until then Roam never offers or labels a step-free route.

## Opening hours (no verified source yet)

Food and services with no hours: Quad Café, Library Café, The Shop, Digby Den and Diner (card says "check on Nest"),
Post Room, Students' Union, Laundry, The Base, The Reef, Davies Sports Hall, Sport and Active Communities, MUGA, playing field, 5-a-side pitch.
Check: Nest (staff screenshot), roehamptonstudent.com, signs on site. Add exceptions (bank holidays, Christmas) when published:
LibCal shows no hours from 20 Dec 2026 yet, and no 2026 festive notice was found.

## Services (searched on official pages; not found or not specific)

- [ ] Cash machine / ATM: no official mention (the Southlands guide calls it a cashless campus; its map has an unexplained "Bank" label near Security). Not added.
- [ ] Defibrillators (AED): no locations found. Only "security officers are first-aid trained" is added (Campus Safety and Security).
- [ ] Accessible toilets: only Queen's Building floor 1 is stated. The gender-neutral toilets page lists buildings but not which ones are accessible.
- [ ] Water refill points: only Queen's Building (each floor). Library and others not found.
- [ ] Microwaves: The Reef (Southlands college kitchen), and the Digby Den kitchen. Other college kitchens: "college kitchens have microwaves" without naming buildings.
- [ ] Lost property: the Library FAQ seems to send people to the Library Welcome Desk, but the page wasn't read directly. Not added.
- [ ] Gender-neutral toilets also listed for "Jubilee" and "Downshire House": Jubilee may be the Dorothy Buchanan Building (OSM name, unconfirmed); Downshire House is on the map (Chadwick plot) but not a place yet.
- [ ] Lecture theatres: only Queen's Building ("lecture halls") and Jebb Auditorium are stated. Mandela, Lawrence and others not found.
- [ ] Printing for posters/binding (AV Resources, Sir David Bell): seen in search results only.

## Places

- [ ] Queen Mary's Hospital: drawn as one block on its OSM outline (OSM's four light wells left out on purpose, for a cleaner look). Address and switchboard (020 8487 6000) from St George's Contact and find us page, 9 Nov 2026. OpenStreetMap has no heights or floor counts for its buildings, so they are drawn at the default height (about 3 floors). The main entrance is OSM's `entrance=main` node (south-west side), not checked on site. The "Minor Injuries Unit temporarily closed" note is from St George's page (checked 9 Nov 2026): re-check, as it says the unit was suspended during Covid and replaced by an appointment-only hub.
- [ ] Buildings around the map: only the first row along Roehampton Lane and Clarence Lane (south of Froebel), Ibstock Place School and the hospital, from OpenStreetMap (the context-zone rule in scripts/build-context.mjs). Default heights where OSM has no `building:levels`; house roofs are a guess (tiled, pitched) unless OSM says flat. The six annotated screenshots for this change didn't arrive with the request: the cut-offs (Southlands' north wall, Clarence Lane east of the Alton estate, 50 m corridor) were chosen from the written notes, so check them against the screenshots.
- [ ] Plots east of Roehampton Lane (between the hospital and Chadwick Hall): asked for were Holy Trinity Old Churchyard, the lawn square round Roehampton House ("Queen Mary's Place") and Pure Pilates. OpenStreetMap has none of these (9 Nov 2026: no `amenity=grave_yard`, park or lawn there, no Pure Pilates; Holy Trinity church is on Ponsonby Road, further south-east), Roehampton House was named at first; its record was removed on 9 Nov 2026 at the owner's request (the estate stays as unnamed background). The estate is drawn on OSM's residential outline (way/385820703), cut straight at Mendez Way: check the churchyard and lawn on site and map them on OSM first. The annotated screenshots for this change didn't arrive.
- [x] South of Chadwick Hall: the records for Eastwood Nursery School, Mosaic Jewish Primary School and Ibstock Place School were removed on 9 Nov 2026 at the owner's request. Their buildings stay on the map as unnamed grey background; no pin, name or card.
- [ ] Removed on request (9 Nov 2026): the Alton estate blocks and paths south of Clarence Lane below Froebel's south-west corner, the two buildings just north of the hospital on Roehampton Lane's east side, and the generated houses on the east side across from Chadwick Hall (the real estate is drawn there now).
- [ ] Low houses on Clarence Lane's south side (below Froebel): generated where OpenStreetMap has no first-row building (`gen/house/*`, decoration, `generated: true`). Real houses, sizes and spacing not checked. The annotated screenshots for this change (9 Nov 2026) didn't arrive: the rows, the hospital's cut-off (`HOSPITAL_MAX_X`) and the north edge above Southlands were chosen from the written notes.
- [ ] Queen Mary's Hospital car park: OpenStreetMap's only parking area on the site (way/104678854) is south of the main building, not north as the note asked, so that one is drawn (its front part). Bays and parked cars are illustration, not real bay counts.
- [ ] Street trees along Roehampton Lane, round Chadwick Hall and north-east of Southlands: OpenStreetMap maps almost none there, so the rows are generated (decoration, `generated: true`). Real positions and species not checked.
- [ ] Ibstock Place School and the 5-a-side pitch: OpenStreetMap draws the Playing Field and the 5-a-side pitch inside Ibstock Place School's grounds (relation/8657820), while Roam lists them as the university's (Froebel). Check who they belong to. Ibstock's sports hall is private, so it isn't listed under Sport.
- [ ] Chadwick Hall (Froebel College, shown as a hall on campus): the map now reaches its plot (OSM way/393563937) along Roehampton Lane, with its three buildings as separate places. Building names were given on site by a resident (8 Nov 2026) and are the reverse of OpenStreetMap's: by Roehampton Lane = North (OSM says South), cross-shaped = West (OSM says North), south = South (OSM says West). Correct the names on OpenStreetMap; build-campus.mjs overrides them until then (NAME_FIX). Doors still unverified.
- [ ] Chadwick Hall's grounds (`scripts/chadwick.mjs`): the paths (lawn, garden loop, front of South), the car gate at the plot's south-east corner, the wall itself and the small car area in the plot's north-east notch were drawn from a resident's sketch over the aerial view (9 Nov 2026), about ±5 m. (An opening at the top of the lawn, from the car area, was drawn too; on 12 Nov 2026 the resident said there is no gate there, so it is wall now and the drive stops in the car area.) None of it is in OpenStreetMap. Walk them and re-pick with `/picker.html`; the car area's size and use are a guess from the sketch.
- [ ] Chadwick Hall's front (a resident's sketch over Roam, 12 Nov 2026, and his answers to two questions about it): the forecourt in front of Downshire House is open to Roehampton Lane, so the wall no longer runs along it (the "pedestrian gate by bus stop S" opening went with it). The wall turns in to North's south-east corner and to South's north-east corner; a wall runs between North and Downshire House. The two ways in to the halls are iron gates, like garden gates, that open with a resident's card: one where the path from bus stop S passes that wall, one across the gap between Downshire House and South. Both are drawn shut, like the map's other iron gates; routes still pass through them, and a route doesn't say yet that a resident's card is needed (only the Chadwick Hall entrance's description does). Positions are read off a hand sketch, about ±3 m. Assumed, not given: the short path from the pavement across the forecourt to the way in beside South (`chadwick/forecourt`), and that nothing but the buildings closes the forecourt's sides. Check on site: the wall's exact line, the width of each way in, whether they are gates (and locked), and what the forecourt's surface is (it is drawn as lawn).
- [ ] Queen Mary's Hospital: added as a nearby place on its OSM main building (relation/1481954, no name in OSM). No entrance, departments or hours: Roam only says to check with the NHS. Map buildings outside Roam's area are no longer drawn; the hospital's main building is the one exception.
- [ ] Downshire House (inside the Chadwick plot, between North and South): now a place ("Other university buildings"), Grade II* listed, c. 1770 (Historic England 1065522). What's inside isn't known; it's listed on the gender-neutral toilets page.
- [ ] Chadwick Hall's shelter (12 Nov 2026): the resident put a cross at the top of the lawn, in front of the north wall: "a tiny building, like a place to sit, not really a building". Drawn there as a small roofed seat (`chadwick/shelter`, about 3.8 m by 2.6 m, open to the lawn); the lawn path ends at it. Its real size, shape and which way it faces aren't known; no pin or name. He also sent an Apple Maps view: not used (its terms don't allow it as a source). Measure and photograph it on site.
- [ ] Chadwick Hall Car Park: OpenStreetMap has no parking area for Chadwick Hall (the parking aisles south of the plot belong to Eastwood Nursery and Mosaic Jewish Primary School). On 12 Nov 2026 a resident put it on the south side of South: the narrow strip (about 6 m on the map) between the building and the plot's south wall, in from the car gate, with three cars parked nose to tail in one line. Drawn so, inside the wall (his sketch ran past it; he asked not to widen the map): asphalt over the strip, three bays along the wall with a car in each, a drive beside the building, the pin on the middle bay. The number of bays, where along the wall they are and the strip's real width aren't known. Check on site.
- [ ] Chadwick Hall entrance (by bus stop S, where the open forecourt meets the lane: no gate there) and Chadwick Hall vehicle gate (south-east corner): not in OpenStreetMap; positions from the resident's sketch (±25 m), shown as not verified.
- [ ] Lynn Chadwick's sculpture "The Watchers" (on the lawn in front of South Court): not in OpenStreetMap (no `tourism=artwork` there, 9 Nov 2026), so not added. Find its spot on site and a source (Historic England or the University), then add it as a landmark.
- [ ] Whitelands College (Holybourne Avenue, SW15 4JD): now on the map as the fourth college, on OpenStreetMap's university outline (way/269315444, which takes in the lawn to the west). Verified from the University (Whitelands page and handbook, 9 Nov 2026): Parkstead House (Grade I), the School of Life and Health Sciences and the School of Psychology, reception 9am–6pm on weekdays, laundry on the ground floor of Cheltenham Block, the Chapel entered through the Chaplaincy. Whitelands College is also a search record of its own (`whitelands-college`, no pin: it stands for the whole site). OpenStreetMap has no separate "Life Sciences" building: the labs are taken to be in Parkstead House, as the University's page says, so no extra building was added. The cross-shaped building south of the grounds (Huntercombe Hospital in OSM) and the tower blocks east of Holybourne Avenue aren't the University's and aren't drawn. **Not verified:** the hall names Beverley, Durham, Gilesgate, Kings, Melrose, Walpole and Sutherland come only from OpenStreetMap's building names (two per building, so each hall place is "X and Y"); only Cheltenham is in the University's text. The playing field's use and who may use it aren't verified.
- [ ] Whitelands' boundary wall: drawn along OSM's outline and left open where OSM paths cross it. Where the real walls, fences and gates are isn't known, and Whitelands' entrances (pedestrian and vehicle) aren't in OSM: walk it and add them (and the gates in the wall).
- [x] Danebury Avenue shops: Premier, Super Clean Launderette and Cafe Joy removed on 9 Nov 2026 at the owner's request. Only Co-op Food and Roehampton Library (public) are listed there (data/allowed-offcampus.json).
- [ ] Amazon Locker on Danebury Avenue: asked for, but OpenStreetMap has no locker on that row (9 Nov 2026; its only `amenity=parcel_locker` nearby is unbranded, on Roehampton Lane south-east of the junction, outside the map). Checked again against the live OpenStreetMap API (9 Nov 2026, the whole Danebury Avenue shop row): no locker. Not added, since its position would be a guess; check on site and map it on OSM, then add it as a nearby place (`parcel`, `amazon`, `locker` aliases, after the Post Room). Until then "parcel", "amazon" and "locker" find the campus Post Room's Amazon Locker.
- [ ] Roehampton Library (public): address and phone from Wandsworth Council, hours from Better (GLL), checked 9 Nov 2026. Drawn on OSM's Allbrook House (way/461160977; the library is its ground floor, way/1558636946) with Danebury Avenue Car Park (way/1049455201) behind it. OSM has no height for Allbrook House, so it's drawn at the default height, though it is a tall block: check its floors.
- [ ] Co-op Food, 39–41 Danebury Avenue (OSM way/932193700): hours 7am–11pm every day from the Co-op store finder, checked 9 Nov 2026. Re-check on bank holidays.
- [ ] Bus stops A (Roehampton Lane / Danebury Avenue, 490003134A) and B and C (Roehampton Library, 490011641B/C): routes and directions from TfL's StopPoint API (9 Nov 2026), positions from OSM nodes. Route 170 stops at B and C (Roehampton Library), not at A.
- [ ] The map's surroundings south of Chadwick Hall (Roehampton Lane down to the Danebury Avenue junction, Danebury Avenue past the shops to Holybourne Avenue): first-row buildings only, from OSM. The Alton estate's tall blocks (5+ floors) and back streets, and Roehampton Lane's run south-east towards Roehampton High Street, are left out on purpose. The block over the Danebury Avenue shops (way/932193691, 4 floors) is kept although it is long.
- [ ] Bus stops X, U, S, T, W, V: routes and direction from TfL's StopPoint API (9 Nov 2026), positions from OpenStreetMap. Check the positions on site, and re-check routes after TfL changes. Live times stay on TfL's site (linked from each stop).
- [ ] Bus stop shelters: every stop on the map gets a drawn shelter and stop pole, turned along the nearest main road and set on the pavement about 6.5 m from the road's centre line (`stopFrames` in src/map.ts). Whether each stop really has a shelter, and which side of the pole it stands, isn't in OpenStreetMap: check on site.
- Removed on 9 Nov 2026, because they stood outside the map's island (their pins floated over empty ground): Londis (Aubyn Square, north-east of the main entrance), Little Waitrose (237–239 Roehampton Lane, past the Danebury Avenue junction) and bus stop M (Roehampton Lane / Danebury Avenue, south-east of the junction). Every other place lies inside the island (checked against the "contextzone" outline).
- [ ] Positions taken from the official map (±20 m) or estimates: Dorothy Buchanan, Chapman Hall, Elm Grove, The Base, MUGA, the car parks, Convent Parlour, the prayer rooms, The Reef, Digby Square, the cafés and the gates. Re-pick on site.
- [ ] No source at all: Fountain, Garden, Froebel car park, Froebel Gate car park.
- [ ] Fountain (Froebel garden): to verify on campus whether it is a drinking fountain. Until then the "Water fountain" name was removed, so a search for water doesn't send anyone to it.

## Walking paths and alignment (checked 9 Nov 2026)

`npm run check:paths` (scripts/check-paths.mjs) now checks the walking graph:
- it is one piece;
- no path runs through a building;
- dead ends on the campus lead somewhere;
- every entrance and door is on the graph;
- the main spots are linked by routes no longer than 2.2 times the straight line (the worst is 1.52).

Findings checked and accepted are in `data/paths-known.json`, each with its reason.

- [x] Today's OSM vs the map's download (`node scripts/osm-path-diff.mjs`, `docs/osm-path-diff.md`): no walking way moved more than 3 m, none added, no route tags changed. One service road (Fairacres, way/8137869) is gone from OSM; routes don't use it. **No change to `data/paths.json` was needed.**
- [x] Alignment against Esri World Imagery (visual reference only, at Digby Stuart, Froebel, Southlands, Chadwick Hall and Whitelands): buildings and paths sit on the imagery. No systematic shift over about 3 m; finer than that, the imagery's lean on tall buildings hides it. Nothing changed.
- [ ] **Elm Grove courtyards (ask the owner):** OSM maps Elm Grove (relation/8673531) and Elm Grove Hall (relation/8673532) with two open courtyards (inner ways 624420817, 624420818). `scripts/build-campus.mjs` keeps only outer rings, so the block is drawn solid and its courtyard footways (OSM ways 624679289–624679292) look as if they run through the building.
  - Routes are right as they are.
  - The GPS filter treats the courtyards as indoors: no snapping onto those footways, and "Inside Elm Grove" on a weak reading there.
  - Fixing it means building holes into the 3D block, its roof and the north/south split. That changes how Elm Grove looks, so it is left for the owner to decide.
- [ ] Dead ends to check on site: three short spurs (by Aldersgate Court, Epworth Court and South Car Park), and the 129 m Whitelands footway ending near Parkstead House (way/921118306). They may lead to doors not mapped. Listed in `data/paths-known.json`.
- [ ] Gate positions: Southlands, Stuart Lodge and Clarence Lane gates in `places.json` (from the University's map) are 11–21 m from OSM's gate nodes. Which is right is unknown: check on site (`docs/osm-fixes.md`).

## Doors (marked 11 Nov 2026)

The owner marked the doors of 45 buildings on a top-down view of each (`docs/doors/2026-11-11-owner-marks.json`, applied with `node scripts/apply-doors.mjs`): 82 doors on 59 places, all main doors, `verified: false` (from memory, not checked on site). Routes now end at the door; the card lists them and shows a small door pin for each.

- [ ] Check the doors on site, then set `verified: true` (the route note changes from "marked by a student" to "Ends at the … entrance").
- [ ] **Fincham Building** (also the Fincham prayer rooms) and **Michaelis Building**: no mapped path reaches the door (a courtyard; 16 m and 37 m from the nearest path, behind a building). The route shows that last stretch dotted. Needs the walkway traced on site, or added to OpenStreetMap (`data/paths-known.json`, `offGraph`).
- [ ] Not marked (owner didn't know, or skipped): Campus Safety and Security, Erasmus House (and The Base inside it), the four Whitelands halls, Whitelands Chapel.
- [x] **Lee House**: the owner noted "kapalı bina" (a closed building). Its description now says "Closed at the moment (a student's note, November 2026)". The owner confirmed on 12 Nov 2026 that it is closed. Still to find out: why and until when (then update or remove the note).
- [x] Froebel Diner uses all three Montefiore doors; Pub & Grub uses the Union Bar's two. Confirmed by the owner on 12 Nov 2026.
- [x] **The Coexist Café** (Fincham Building, Fi009): taken off the site on 12 Nov 2026 at the owner's request, because it is closed. Its record, its mention on the Fincham Building's card and its line in `data/paths-known.json` are gone. Add it back only if the owner asks.

