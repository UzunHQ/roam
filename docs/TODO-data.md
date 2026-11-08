# Data still to verify

Roam only shows what has a source. Everything below is missing or unverified, with where to check it.
Last reviewed: 8 Nov 2026.

## Entrances (no place has any yet)

Every route ends "on the path nearest the building". To fix: walk the campus, pick each door with
`/picker.html` and add `entrances` to `data/places.json` (format in `docs/DEVELOPMENT.md`, Directions).
Mark `type` (`main`, `accessible`, `card-required`, `closed`) and `verified: true` only for doors checked on site.

- [ ] Main doors of the teaching buildings: Mandela, Sir David Bell, Fincham, Howard, Dorothy Buchanan, Mary Seacole, Queen's Building, Lawrence, Michaelis, Grove House, Jebb Auditorium, Lulham, Gilroy, Brearley
- [ ] Library (main door and the step-free entrance)
- [ ] Food places inside other buildings: Costa, Froebel Diner, Union Bar, Pub & Grub (Montefiore); Library Café; Quad Café
- [ ] Which doors need a card, and which are closed out of hours
- [ ] Halls: every block's door (Chadwick Hall's three buildings included)

## Rooms

- [ ] Floors and ways in for timetable rooms (`rooms` in places.json). Today only the building is known from the room-code prefix.
- [ ] Room-code prefixes for buildings that have none yet (e.g. Elm Grove, Erasmus House, Lawrence's rooms if not "La").

## Step-free routes

- [ ] Paths checked end to end for steps, kerbs and slopes. Until then Roam never offers or labels a step-free route.

## Opening hours (no verified source yet)

Food and services with no hours: Quad Café, Library Café, The Shop, The Coexist Café, Digby Den and Diner (card says "check on Nest"),
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
- [ ] Gender-neutral toilets also listed for "Jubilee" and "Downshire House": Jubilee may be the Dorothy Buchanan Building (OSM name, unconfirmed); Downshire House isn't in Roam yet.
- [ ] Lecture theatres: only Queen's Building ("lecture halls") and Jebb Auditorium are stated. Mandela, Lawrence and others not found.
- [ ] Printing for posters/binding (AV Resources, Sir David Bell): seen in search results only.

## Places

- [ ] Chadwick Hall: the university says it is part of Froebel College, so it is shown as a hall, not "off campus". Its position is the middle of its three OpenStreetMap blocks (±15 m); its footprints aren't in campus.geojson yet (rebuild with `npm run build:campus` after widening the area to the south). The campus map PDF shows it only as an inset.
- [ ] Whitelands College (Holybourne Avenue, SW15 4JD) and its halls (Beverley, Cheltenham, Durham, Gilesgate, Kings, Melrose, Walpole, Sutherland): a separate site outside this map's area. Not added.
- [ ] Bus stops come from OpenStreetMap (positions and stop letters). Check on site; live times would need the TfL API (see the feature plan).
- [ ] Londis (Aubyn Square): from OpenStreetMap, no hours. Is there a closer supermarket on Roehampton Lane? Not in OSM.
- [ ] Positions taken from the official map (±20 m) or estimates: Dorothy Buchanan, Chapman Hall, Elm Grove, The Base, MUGA, the car parks, Convent Parlour, the prayer rooms, The Reef, Digby Square, the cafés and the gates. Re-pick on site.
- [ ] No source at all: Fountain, Garden, Froebel car park, Froebel Gate car park.
- [ ] "Fountain" lists "Water fountain" as a service: check it's a drinking fountain and not just the ornamental one, or remove it.
