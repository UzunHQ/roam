# Possible fixes for OpenStreetMap itself

Things that look wrong **in OSM** (not in Roam's own data), found while checking the walking graph
on 9 Nov 2026 (`npm run check:paths`, `node scripts/osm-path-diff.mjs`, and Esri World Imagery as a
visual reference: Esri allows its imagery for tracing and checking OSM edits). Roam doesn't edit
OSM. The owner reviews each one and makes the edit if it holds up.

| Where | What looks wrong | Based on | Confidence |
|---|---|---|---|
| Aldersgate Court ([way/1339072173](https://www.openstreetmap.org/way/1339072173)) and the service road past it ([way/29500257](https://www.openstreetmap.org/way/29500257)), about 51.45929, -0.24527 | The road clips the building's south-west corner (about 2 m, along 5.7 m). On the imagery the road passes beside the building, so one of the two lines is drawn a little off. | Esri World Imagery, overlay | Low: under the imagery's own error for a tall building. Check on site or with a second imagery source before editing. |
| Fairacres ([way/8137869](https://www.openstreetmap.org/way/8137869)), service road, about 51.46072, -0.24402 | In the map's October download but gone from OSM now; nothing has replaced it within 15 m. Either the road was removed on purpose (it no longer exists) or deleted by mistake. | `docs/osm-path-diff.md` | Unknown: look at the way's history on osm.org. Roam's routes don't use it (the nearest graph node is 31 m away). |
| Campus gates vs OSM gate nodes | Southlands Gate: OSM's gate ([node/6606467293](https://www.openstreetmap.org/node/6606467293)) is 21 m from where the University's map puts it. Stuart Lodge Gate: 11 m ([node/5937875658](https://www.openstreetmap.org/node/5937875658)). Clarence Lane: 13 m ([node/2652085290](https://www.openstreetmap.org/node/2652085290)). Chadwick Hall: OSM has only `entrance=main` (node/6106607124), not a gate on Roehampton Lane. | `docs/osm-path-diff.md` | Unknown which is right: check on site, then fix OSM or `data/places.json`. |

Not OSM's fault, and so not listed here:
- The Elm Grove footways look as if they cross the building. OSM maps its two courtyards
  correctly; Roam's build drops them (see `docs/TODO-data.md`).
