// Chadwick Hall's grounds (Froebel College halls, OSM plot way/393563937): paths, gates, walls and
// car parking, which OpenStreetMap doesn't have. Drawn from a resident's sketches on the map
// (9 Nov 2026 over the aerial view; 12 Nov 2026 over Roam itself: the front wall, the two gates in
// to the halls, the car park, the shelter at the top of the lawn and the wall behind it, where an
// opening had been drawn), so positions are about ±5 m and not checked on site
// (docs/TODO-data.md). Shared by build-campus.mjs (drawing), build-paths.mjs (the walking graph)
// and build-walls.mjs (the plot's wall).
//
// Local metres east/north of ORIGIN, the same frame as build-campus.mjs.
const ORIGIN = [-0.246, 51.4555];
const KX = 111320 * Math.cos((ORIGIN[1] * Math.PI) / 180), KY = 111320;
const round = (v) => Math.round(v * 1e6) / 1e6;
export const fromM = ([x, y]) => [round(ORIGIN[0] + x / KX), round(ORIGIN[1] + y / KY)];

// `lane: true` on a path's first point: it meets Roehampton Lane's pavement there (joined to the
// nearest node of the walking graph by build-paths.mjs)
const M = {
  // the drive in from Roehampton Lane to the car area (the plot's wall is shut behind it)
  drive: [[157, -218], [146.5, -218], [125.5, -218]],
  // from the shelter at the top of the lawn, down between West and North, past Downshire House,
  // to the front of South
  lawn: [[112.95, -220.4], [112, -245], [111.6, -264], [106, -276], [105.8, -279], [104.5, -303.7]],
  // along South's north face, past its door
  southFront: [[90, -301.5], [104.5, -303.7], [122, -306.3], [130, -307.5]],
  // from the pedestrian gate by bus stop S, under North, to the lawn
  laneGate: [[153, -264.5], [142.6, -264.5], [120, -264.5], [111.6, -264]],
  // the car gate at the south-east corner, into the car park along South's south side (the point
  // beside the middle bay is there for the walking graph: a route to the car park ends on it)
  carGate: [[146, -321], [134.1, -320], [130.6, -323.4], [128, -324.6], [107.8, -321.53], [101.7, -320.6]],
  // across the forecourt, which is open to Roehampton Lane, to the way in between Downshire House
  // and South. The resident gave the open forecourt and the way in; this line across is assumed.
  forecourt: [[144, -308.5], [130, -307.5]],
  // a loop through the garden, west of the lawn
  garden: [[111.6, -264], [98, -267], [80, -265], [62, -268], [50, -277], [56, -288], [78, -287], [96, -282], [105.8, -279]],
};
export const CHADWICK_PATHS = [
  { id: 'chadwick/drive', kind: 'service', lane: true, coords: M.drive },
  { id: 'chadwick/lawn', kind: 'footpath', coords: M.lawn },
  { id: 'chadwick/south-front', kind: 'footpath', coords: M.southFront },
  { id: 'chadwick/lane-gate', kind: 'footpath', lane: true, coords: M.laneGate },
  { id: 'chadwick/car-gate', kind: 'service', lane: true, coords: M.carGate },
  { id: 'chadwick/forecourt', kind: 'footpath', lane: true, coords: M.forecourt },
  { id: 'chadwick/garden', kind: 'footpath', coords: M.garden },
].map((p) => ({ ...p, ll: p.coords.map(fromM) }));

// openings in the plot's wall: where the car gate passes it. (An opening at the top of the lawn,
// from the car area, was drawn here until 12 Nov 2026: the resident says it is wall.)
export const CHADWICK_GATES = [
  { name: 'car gate', at: fromM([134.1, -320]), width: 5 },
];

// The wall at the front, as the resident drew it (12 Nov 2026). The forecourt in front of Downshire
// House is open to Roehampton Lane: the plot's wall stops on its east side at `open.north` and
// `open.south` and turns in to the buildings there (North's south-east corner, South's north-east
// corner). A wall between North and Downshire House closes the gardens behind. The two ways in to
// the halls are iron gates, like garden gates, that open with a resident's card: one where the
// path from bus stop S passes that wall, one in the gap between Downshire House and South.
export const CHADWICK_WALL = {
  open: { north: fromM([143, -261]), south: fromM([135.6, -310.6]) },
  toNorth: fromM([135.1, -261.2]),
  toSouth: fromM([127.6, -309.7]),
  inner: [[127.4, -261], [126.1, -277]].map(fromM),
  entrances: [
    { name: 'card gate between North and Downshire House', at: fromM([127.1, -264.5]), width: 4, gate: true },
    // (its posts stand against the two buildings: Downshire House's corner, South's north face)
    { name: 'card gate between Downshire House and South', posts: [[121.7, -304.3], [121.95, -308.85]].map(fromM), gate: true },
  ],
};

// the small car area between the plot's north-east notch and Roehampton Lane
export const CHADWICK_CAR_AREA = [[122.6, -210.5], [146.8, -210.5], [146.6, -221], [122.6, -220.6], [122.6, -210.5]].map(fromM);
// the extra corners the map's edge takes in for it (the plot's own outline leaves the notch out)
export const CHADWICK_EDGE_EXTRA = [[122.3, -209.5], [147.5, -209.5]];

// The car park (the resident, 12 Nov 2026): the narrow strip between South's south face and the plot's
// south wall, in from the car gate. Three bays nose to tail along the wall, a car in each. Local
// metres. `kerb` is the bays' wall-side edge (they lie to its left), centred on its middle.
export const CHADWICK_CAR_PARK = {
  area: [[89.3, -317.3], [125.7, -322.7], [127.5, -310.6], [134.9, -311.4], [134, -317.6], [133.3, -322.5], [132.1, -329.3], [89.2, -322.7]],
  kerb: [[99.15, -323.84], [115.15, -326.3]],
  bays: 3,
};

// A small shelter to sit in, at the top of the lawn in front of the north wall (the resident's
// cross on the map, 12 Nov 2026: "a tiny building, like a place to sit, not really a building").
// Its size and the way it faces aren't known: drawn about 3.8 m by 2.6 m, open to the lawn.
export const CHADWICK_SHELTER = { at: fromM([112.9, -218.9]), a: -Math.PI / 2 };

// South's door: on its north face, near the east end (the resident's arrow)
export const SOUTH_DOOR = fromM([121, -308.7]);
