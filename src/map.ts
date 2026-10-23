import * as maplibregl from 'maplibre-gl';
import { type ExpressionSpecification as Expr, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { LngLat } from './types';
import { ROOFS, isPitched } from './roofs';

// maplibre-gl 6 looks for its worker next to its own module, which Vite bundles away; point it at the emitted file.
maplibregl.setWorkerUrl(workerUrl);

export type Theme = 'light' | 'dark';

// Pastel daytime miniature: sage grass, cream footpaths, grey roads, turquoise water.
// Walls are warm cream; roofs carry a pastel colour per college (Digby Stuart blue,
// Froebel yellow, Southlands lavender) so the three zones stay recognisable.
const PALETTE = {
  light: {
    bg: '#cfe3be', green: '#c1dcab', wood: '#a6cd8f', pitch: '#b6d99b', pitchLine: '#eef8e4',
    water: '#86d4cf', shore: '#c6efea', road: '#d4d8d8', roadEdge: '#b9bfbf', footpath: '#fcf3dc', footpathEdge: '#d8c08b',
    wall: '#fcf6ea', wallOff: '#efe9de',
    digbyRoof: '#a8cdee', froebelRoof: '#f6d77a', southlandsRoof: '#bba9e8', otherRoof: '#ecd3bb', offRoof: '#d8d3c9',
    digbyRim: '#86b3dc', froebelRim: '#e2bd55', southlandsRim: '#9f8ad6', otherRim: '#d6b799', offRim: '#c3bdb2',
    glass: '#b9d3e6', frame: '#e6dccb', glassOff: '#cfd6db',
    slate1: '#7d8896', slate2: '#919cab', slate3: '#a8b2c0', tile1: '#c7876a', tile2: '#d49a7c', tile3: '#e0ad91',
    greenRoof: '#9fcb7c', solar: '#6a86a8', metal: '#bfcdd8',
    selected: '#ff7a59', selectedWall: '#ffe2d8', trunk: '#a27b5b', leaf: '#8fcb7d', leafDark: '#6fb465', accuracy: '#3b82f6',
    tones: ['#7fc36d', '#6aae5f', '#94cf7c', '#5f9f58', '#a9d47f'], blossom: '#f4b8c8',
    route: '#ff4f7b', routeCase: '#ffffff', routeFlow: '#ffffff', outside: '#c2d8b1', shadow: 'rgba(52,70,40,0.14)',
    stones: ['#b5835b', '#a77852', '#c0906a'], pier: '#bc8b62', plinth: '#7a583e', coping: '#e0c8a2', iron: '#1f3a30', lamp: '#ffe39a',
    cars: ['#f3f1ec', '#c3c9cf', '#5d6670', '#c7675a', '#6b8fb5', '#d9c58f'], carGlass: '#62788c', basin: '#e4dccb', jet: '#d6f3f1',
    fencePost: '#3d5a49', fenceMesh: '#4a6656',
  },
  dark: {
    bg: '#1f2e28', green: '#27402f', wood: '#2b4a37', pitch: '#2a4934', pitchLine: '#46664f',
    water: '#2a6466', shore: '#3f8384', road: '#4a5157', roadEdge: '#2c3237', footpath: '#6d6450', footpathEdge: '#4d4636',
    wall: '#5a6168', wallOff: '#3d434a',
    digbyRoof: '#5689b0', froebelRoof: '#b39545', southlandsRoof: '#7666a8', otherRoof: '#7a6a5a', offRoof: '#454a52',
    digbyRim: '#456f90', froebelRim: '#917834', southlandsRim: '#5e5188', otherRim: '#625548', offRim: '#3a3f46',
    glass: '#e9d8a0', frame: '#4b5157', glassOff: '#8a8466',
    slate1: '#3f4650', slate2: '#4b535e', slate3: '#58616d', tile1: '#7a4f3f', tile2: '#86594a', tile3: '#926556',
    greenRoof: '#4f7a45', solar: '#2c4058', metal: '#66737d',
    selected: '#ff8a6b', selectedWall: '#8a5d52', trunk: '#6e5340', leaf: '#3f7a4c', leafDark: '#2f6140', accuracy: '#6ea6ff',
    tones: ['#3f7a4c', '#356b42', '#4a8655', '#2f6140', '#557f45'], blossom: '#9a6a7a',
    route: '#ff7f9c', routeCase: '#1b2228', routeFlow: '#ffe3ea', outside: '#19261f', shadow: 'rgba(0,0,0,0.28)',
    stones: ['#6a4c37', '#5e4331', '#745540'], pier: '#71523c', plinth: '#3a2a1f', coping: '#8a7660', iron: '#0d1a15', lamp: '#ffd36b',
    cars: ['#b9b8b3', '#8b939b', '#3b4148', '#8a4a41', '#4b6683', '#9a8a5f'], carGlass: '#24303a', basin: '#6f6a60', jet: '#7fb9b8',
    fencePost: '#9db2a5', fenceMesh: '#b7c9bd',
  },
} as const;

type Pal = (typeof PALETTE)[Theme];

const roofColor = (p: Pal): Expr => [
  'case', ['!', ['coalesce', ['get', 'campus'], true]], p.offRoof,
  ['match', ['get', 'college'],
    'digby-stuart', p.digbyRoof,
    'froebel', p.froebelRoof,
    'southlands', p.southlandsRoof,
    p.otherRoof],
];
const rimColor = (p: Pal): Expr => [
  'case', ['!', ['coalesce', ['get', 'campus'], true]], p.offRim,
  ['match', ['get', 'college'],
    'digby-stuart', p.digbyRim,
    'froebel', p.froebelRim,
    'southlands', p.southlandsRim,
    p.otherRim],
];
/** Roof parts: flat panels keep the college pastel; pitched roofs are slate or tile in three steps. */
const partColor = (p: Pal): Expr => ['match', ['get', 'part'],
  'panel', ['match', ['get', 'kind'], 'metal', p.metal, roofColor(p)],
  'patch', ['match', ['get', 'kind'], 'green', p.greenRoof, p.solar],
  'p1', ['match', ['get', 'kind'], 'tile', p.tile1, p.slate1],
  'p2', ['match', ['get', 'kind'], 'tile', p.tile2, p.slate2],
  ['match', ['get', 'kind'], 'tile', p.tile3, p.slate3],
];
const wallColor = (p: Pal): Expr => ['case', ['coalesce', ['get', 'campus'], true], p.wall, p.wallOff];
const SELECTED: Expr = ['boolean', ['feature-state', 'selected'], false];
// layer filters, kept here so see-through mode (setXray) can add to them and put them back
const TOP_FILTER: Expr = ['!', ['all', ['==', ['get', 'part'], 'patch'], ['==', ['get', 'kind'], 'solar']]];
const SOLAR_FILTER: Expr = ['all', ['==', ['get', 'part'], 'patch'], ['==', ['get', 'kind'], 'solar']];
const inIds = (ids: string[]): Expr => ['in', ['get', 'osmId'], ['literal', ids]];

// chunky: unknown heights become 2-3 storeys; known ones are kept
const HEIGHT: Expr = ['coalesce', ['get', 'height'], ['match', ['get', 'building'], ['house', 'detached', 'shed', 'garage'], 6, 9]];
const BOUNCE: Expr = ['*', ['coalesce', ['feature-state', 'bounce'], 0], 5];
const ROOF = 1.2; // parapet: full footprint, in the college's rim colour (a low 0.5 m eave on pitched roofs)
const RIM: Expr = ['+', HEIGHT, BOUNCE, ['match', ['get', 'roof'], ['slate', 'tile'], 0.5, ROOF]];

/** Paint properties that change with the theme, applied on load and on theme switch. */
function themedPaint(p: Pal): Record<string, Record<string, unknown>> {
  return {
    background: { 'background-color': p.bg },
    outside: { 'fill-color': p.outside },
    green: { 'fill-color': ['case', ['get', 'wooded'], p.wood, ['coalesce', ['get', 'field'], false], p.pitch, p.green] },
    pitch: { 'fill-color': p.pitch, 'fill-outline-color': p.pitchLine },
    parking: { 'fill-color': p.road }, // the same asphalt as the roads
    courtline: { 'line-color': p.pitchLine },
    'fence-mesh': { 'fill-extrusion-color': p.fenceMesh },
    water: { 'fill-color': p.water },
    shore: { 'line-color': p.shore },
    waterway: { 'line-color': p.water },
    'road-edge': { 'line-color': ['match', ['get', 'kind'], 'footpath', p.footpathEdge, 'wall', p.plinth, p.roadEdge] },
    road: { 'line-color': ['match', ['get', 'kind'], 'footpath', p.footpath, 'wall', p.stones[1], p.road] },
    'building-walls': { 'fill-extrusion-color': ['case', SELECTED, p.selectedWall, wallColor(p)] },
    'building-roof': { 'fill-extrusion-color': ['case', SELECTED, p.selected, rimColor(p)] },
    'building-top': { 'fill-extrusion-color': ['case', SELECTED, p.selected, partColor(p)] },
    'building-ghost': { 'fill-extrusion-color': ['case', SELECTED, p.selected, roofColor(p)] },
    'tree-trunk': { 'fill-extrusion-color': p.trunk },
    'tree-leaf': { 'fill-extrusion-color': ['match', ['get', 'tone'], 0, p.tones[0], 1, p.tones[1], 2, p.tones[2], 3, p.tones[3], 4, p.tones[4], p.blossom] },
    accuracy: { 'fill-color': p.accuracy },
    'accuracy-line': { 'line-color': p.accuracy },
    route: { 'line-color': p.route },
    'route-case': { 'line-color': p.routeCase },
    'route-hop': { 'line-color': p.route },
    'route-flow': { 'line-color': p.routeFlow },
    'building-shadow': { 'fill-color': p.shadow },
    'wall-3d': {
      'fill-extrusion-color': ['match', ['get', 'part'],
        'plinth', p.plinth, 'pier', p.pier, 'cope', p.coping, 'iron', p.iron, 'lamp', p.lamp,
        ['match', ['get', 'tone'], 0, p.stones[0], 1, p.stones[1], p.stones[2]]],
    },
    'building-halo': { 'line-color': p.selected },
    'half-walls': { 'fill-extrusion-color': p.selectedWall },
    'half-roof': { 'fill-extrusion-color': p.selected },
    props: {
      'fill-extrusion-color': ['match', ['get', 'part'],
        'cabin', p.carGlass, 'basin', p.basin, 'water', p.water, 'jet', p.jet, 'post', p.fencePost,
        ['match', ['get', 'c'], 0, p.cars[0], 1, p.cars[1], 2, p.cars[2], 3, p.cars[3], 4, p.cars[4], p.cars[5]]],
    },
  };
}

let treeCenters: LngLat[] = [];

/**
 * Blocks drawn as one building but selected in halves (layer "half" in campus.geojson, see SPLITS
 * in build-campus.mjs): Elm Grove is the north half of its block, Elm Grove Hall the south half.
 */
let halves: { id: string; block: string; ring: LngLat[] }[] = [];
const isHalf = (osmId: string | null) => !!osmId && halves.some((h) => h.id === osmId);
const inRing = ([x, y]: LngLat, r: LngLat[]) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
/** The half of a split block under a tap (or the building itself when it isn't split). */
export function pickHalf(osmId: string, at: LngLat): string {
  const own = halves.find((h) => h.id === osmId);
  if (!own) return osmId;
  const mine = halves.filter((h) => h.block === own.block);
  return (mine.find((h) => inRing(at, h.ring)) ?? own).id;
}
/** a half's outline pushed out a few centimetres, so its highlight sits just over the block's walls */
function grown(ring: LngLat[], m: number): LngLat[] {
  const pts = ring.slice(0, -1);
  const c = pts.reduce(([x, y], p) => [x + p[0] / pts.length, y + p[1] / pts.length], [0, 0]);
  const kx = 111320 * Math.cos((c[1] * Math.PI) / 180), ky = 111320;
  const out = pts.map(([x, y]) => {
    const dx = (x - c[0]) * kx, dy = (y - c[1]) * ky, l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * (m / kx), y + (dy / l) * (m / ky)] as LngLat;
  });
  out.push(out[0]);
  return out;
}

/**
 * Shrinks an outline by `m` metres (mitred offset, works for L- and U-shapes). Returns null when
 * the building is too narrow for that inset, so roofs never poke out past their walls.
 */
function inset(ringLL: LngLat[], m: number): LngLat[] | null {
  const ring = ringLL.slice(0, -1);
  if (ring.length < 3) return null;
  const lat0 = ring[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
  // drop tiny notches and near-straight corners first (smallest triangle under 4 m² goes), so the
  // roof follows the building's main shape and the offset outline doesn't snag on itself
  const pts = ring.map(([x, y]) => [x * kx, y * ky]);
  const tri = (a: number[], b: number[], c: number[]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (pts.length > 4) {
    let min = Infinity, at = -1;
    for (let i = 0; i < pts.length; i++) {
      const t = tri(pts[(i - 1 + pts.length) % pts.length], pts[i], pts[(i + 1) % pts.length]);
      if (t < min) { min = t; at = i; }
    }
    if (min >= 4) break;
    pts.splice(at, 1);
  }
  const signedArea = (q: number[][]) => { let a = 0; for (let i = 0; i < q.length; i++) { const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length]; a += x0 * y1 - x1 * y0; } return a / 2; };
  let perim = 0;
  for (let i = 0; i < pts.length; i++) perim += Math.hypot(pts[(i + 1) % pts.length][0] - pts[i][0], pts[(i + 1) % pts.length][1] - pts[i][1]);
  const area = signedArea(pts);
  // area / perimeter is about half the width of a long block: keep the inset well inside that
  if (Math.abs(area) < 60 || m > 0.9 * (Math.abs(area) / perim)) return null; // too small or too narrow
  const sign = area > 0 ? 1 : -1; // counter-clockwise: inward is to the left of each edge
  const unitIn = (a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(-dy / l) * sign, (dx / l) * sign]; };
  const moved = pts.map((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
    const n1 = unitIn(prev, p), n2 = unitIn(p, next);
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const k = Math.min(m / Math.max(1 + dot, 0.25), m * 3); // mitre, capped on sharp corners
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
  // where the offset outline crosses itself (a corner notch or the inside of a C-shape turned
  // inside out), cut the small reversed loop off at the crossing and keep the main roof
  const cross = (a: number[], b: number[], c: number[], d: number[]): number[] | null => {
    const o = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    if (!(d1 * d2 < -1e-9 && d3 * d4 < -1e-9)) return null;
    const t = d3 / (d3 - d4);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  let poly = moved;
  for (let guard = 0; guard < 24; guard++) {
    const n = poly.length;
    let hit: [number, number, number[]] | null = null;
    for (let i = 0; i < n && !hit; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
        const p = cross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]);
        if (p) { hit = [i, j, p]; break; }
      }
    }
    if (!hit) break;
    const [i, j, p] = hit;
    const a = [p, ...poly.slice(i + 1, j + 1)];
    const b = [...poly.slice(j + 1), ...poly.slice(0, i + 1), p];
    const score = (q: number[][]) => (Math.sign(signedArea(q)) === sign ? Math.abs(signedArea(q)) : -1);
    poly = score(a) >= score(b) ? a : b;
    if (poly.length < 3) return null;
  }
  const a2 = signedArea(poly);
  if (Math.sign(a2) !== sign || Math.abs(a2) < Math.abs(area) * 0.12) return null; // collapsed or turned inside out
  // every corner of the inset roof must still be over the building
  const inside = ([x, y]: number[]) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  if (!poly.every(inside)) return null;
  const out = poly.map(([x, y]) => [x / kx, y / ky] as LngLat);
  out.push(out[0]);
  return out;
}

/**
 * A rectangle lined up with the building's longest wall, shrunk by `m` metres: the fallback for
 * the planted/solar area on outlines too jagged to inset cleanly. Null if it would leave the roof.
 */
function innerRect(ringLL: LngLat[], m: number): LngLat[] | null {
  const ring = ringLL.slice(0, -1);
  const lat0 = ring[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
  const pts = ring.map(([x, y]) => [x * kx, y * ky]);
  let best = 0, ang = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > best) { best = l; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); } });
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const rot = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const xs = rot.map((p) => p[0]), ys = rot.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) + m, Math.max(...xs) - m, Math.min(...ys) + m, Math.max(...ys) - m];
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const back = ([x, y]: number[]) => [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)];
  const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(back);
  const inside = ([x, y]: number[]) => {
    let r = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
    }
    return r;
  };
  if (!rect.every(inside)) return null;
  const out = rect.map(([x, y]) => [x / kx, y / ky] as LngLat);
  out.push(out[0]);
  return out;
}

/**
 * The parts that sit on top of each building's walls and parapet:
 *  - flat roofs: a pastel panel inset 1 m (plus a planted or solar patch where the roof has one)
 *  - pitched roofs: three stepped, shrinking slate/tile layers, a low-poly hip roof
 * Heights are relative to the wall height `h`, matching HEIGHT in the walls layer.
 */
function roofParts(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const f of fc.features) {
    if (f.geometry.type !== 'Polygon') continue;
    const pr = f.properties ?? {};
    const kind = pr.roof ?? 'flat';
    const h = pr.height ?? (['house', 'detached', 'shed', 'garage'].includes(pr.building) ? 6 : 9);
    const ring = f.geometry.coordinates[0] as LngLat[];
    const add = (d: number, part: string, base: number, top: number, shape = inset) => {
      const poly = shape(ring, d);
      if (poly) out.push({ type: 'Feature', properties: { osmId: pr.osmId, college: pr.college, campus: pr.campus, kind, h, part, base, top }, geometry: { type: 'Polygon', coordinates: [poly] } });
      return !!poly;
    };
    if (isPitched(kind)) {
      if (add(1.2, 'p1', 0.5, 1.7) && add(2.7, 'p2', 1.7, 2.8)) add(4.2, 'p3', 2.8, 3.7);
    } else {
      add(1, 'panel', ROOF, ROOF + 0.45);
      // planted or solar area: as far in as the outline allows
      if (kind === 'green' || kind === 'solar') {
        [3.5, 2.5, 1.6].some((d) => add(d, 'patch', ROOF + 0.45, ROOF + 0.6)) || add(5, 'patch', ROOF + 0.45, ROOF + 0.6, innerRect);
      }
    }
  }
  return { type: 'FeatureCollection', features: out };
}

/** A small repeating wall tile with one window, drawn for the current theme. */
function windowTile(wall: string, frame: string, glass: string): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const g = c.getContext('2d')!;
  g.fillStyle = wall; g.fillRect(0, 0, 24, 24);
  g.fillStyle = frame; g.fillRect(6, 6, 12, 11);
  g.fillStyle = glass; g.fillRect(7.5, 7.5, 9, 8);
  return g.getImageData(0, 0, 24, 24);
}
function solarTile(cell: string, line: string): ImageData {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 12;
  const g = c.getContext('2d')!;
  g.fillStyle = line; g.fillRect(0, 0, 16, 12);
  g.fillStyle = cell; g.fillRect(1, 1, 14, 10);
  g.fillStyle = line; g.globalAlpha = 0.5; g.fillRect(8, 1, 1, 10); g.fillRect(1, 6, 14, 1);
  return g.getImageData(0, 0, 16, 12);
}
function setWindowImages(map: MLMap, p: Pal) {
  const solar = solarTile(p.solar, p.frame);
  if (map.hasImage('solar-cells')) map.updateImage('solar-cells', solar); else map.addImage('solar-cells', solar, { pixelRatio: 2 });
  for (const [id, data] of [['win', windowTile(p.wall, p.frame, p.glass)], ['win-off', windowTile(p.wallOff, p.frame, p.glassOff)]] as const) {
    if (map.hasImage(id)) map.updateImage(id, data); else map.addImage(id, data, { pixelRatio: 2 });
  }
}
/** Windows appear on the walls only when you're close enough to see them. */
const WINDOW_ZOOM = 17.4;
function updateWindows(map: MLMap) {
  const want = map.getZoom() >= WINDOW_ZOOM;
  const has = map.getPaintProperty('building-walls', 'fill-extrusion-pattern') != null;
  if (want === has) return;
  map.setPaintProperty('building-walls', 'fill-extrusion-pattern', want ? ['case', ['coalesce', ['get', 'campus'], true], 'win', 'win-off'] : undefined);
}

/**
 * Low-poly trees: a hexagonal trunk under a rounded canopy of three stacked octagons (narrow,
 * wide, narrow). Each tree gets one of five greens, and about one in twenty is in blossom.
 */
function treePolygons(points: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  const ngon = ([lng, lat]: number[], r: number, rot: number, n: number): GeoJSON.Polygon => {
    const dLat = r / 111320, dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
    const ring = Array.from({ length: n + 1 }, (_, i) => {
      const a = rot + (i % n) * ((2 * Math.PI) / n);
      return [lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)];
    });
    return { type: 'Polygon', coordinates: [ring] };
  };
  const out: GeoJSON.Feature[] = [];
  treeCenters = [];
  for (const f of points) {
    const c = (f.geometry as GeoJSON.Point).coordinates;
    const t = treeCenters.push(c as LngLat) - 1;
    const s = (f.properties?.s as number) ?? 1;
    const rot = (c[0] * 1e6) % 1;
    // a stable pseudo-random number per tree, so colours don't change between visits
    const h = Math.abs(Math.sin(c[0] * 12.9898e3 + c[1] * 78.233e3) * 43758.5453) % 1;
    const tone = h < 0.05 ? 5 : Math.floor((h * 100) % 5);
    out.push({ type: 'Feature', properties: { t, part: 'trunk', base: 0, top: 2.2 * s }, geometry: ngon(c, 0.45 * s, rot, 6) });
    out.push({ type: 'Feature', properties: { t, tone, part: 'leaf', tier: 0, base: 2 * s, top: 3.4 * s }, geometry: ngon(c, 2.1 * s, rot, 8) });
    out.push({ type: 'Feature', properties: { t, tone, part: 'leaf', tier: 1, base: 3.4 * s, top: 5.6 * s }, geometry: ngon(c, 2.6 * s, rot + 0.2, 8) });
    out.push({ type: 'Feature', properties: { t, tone, part: 'leaf', tier: 2, base: 5.6 * s, top: 7.1 * s }, geometry: ngon(c, 1.7 * s, rot + 0.4, 8) });
  }
  return { type: 'FeatureCollection', features: out };
}

/**
 * Parked cars (data/campus.geojson, layer "car"): a body box about 4.3 x 1.8 m and a glassy cabin
 * set towards the back, turned by `a` (radians, the way the car points) and painted colour `c`.
 */
const CAR = { long: 4.3, wide: 1.8, body: 0.85, cabinLong: 2.3, cabinWide: 1.6, cabinTop: 1.45, cabinBack: 0.3 };
function carParts(points: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const f of points) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const a = Number(f.properties?.a) || 0, c = f.properties?.c ?? 0;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    const box = (along: number, hx: number, hy: number) => {
      const r = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => {
        const x = u[0] * (along + hx * i) + v[0] * hy * j, y = u[1] * (along + hx * i) + v[1] * hy * j;
        return [lng + x / kx, lat + y / ky];
      });
      return { type: 'Polygon', coordinates: [r] } as GeoJSON.Polygon;
    };
    out.push({ type: 'Feature', properties: { part: 'body', c, base: 0, top: CAR.body }, geometry: box(0, CAR.long / 2, CAR.wide / 2) });
    out.push({ type: 'Feature', properties: { part: 'cabin', c, base: CAR.body, top: CAR.cabinTop }, geometry: box(CAR.cabinBack, CAR.cabinLong / 2, CAR.cabinWide / 2) });
  }
  return { type: 'FeatureCollection', features: out };
}

/**
 * The fountain on the round lawn north of Grove House (layer "fountain"): an octagonal stone basin
 * with water in it, a pedestal and a small bowl in the middle, and a short jet on top.
 */
function fountainParts(points: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const f of points) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const oct = (r: number) => Array.from({ length: 9 }, (_, i) => {
      const a = ((i % 8) * Math.PI) / 4 + Math.PI / 8;
      return [lng + (r * Math.cos(a)) / kx, lat + (r * Math.sin(a)) / ky];
    });
    const put = (part: string, base: number, top: number, rings: number[][][]) =>
      out.push({ type: 'Feature', properties: { part, base, top }, geometry: { type: 'Polygon', coordinates: rings } });
    put('basin', 0, 0.55, [oct(3.2), oct(2.7).reverse()]); // the rim, a ring
    put('water', 0, 0.42, [oct(2.75)]);
    put('basin', 0, 1.25, [oct(0.45)]); // pedestal
    put('basin', 1.25, 1.45, [oct(1.1)]); // bowl
    put('jet', 1.45, 2.3, [oct(0.2)]);
  }
  return { type: 'FeatureCollection', features: out };
}

/**
 * Wire fences (layer "fence", the MUGA's): a thin see-through mesh `height` metres tall, drawn in
 * its own half-transparent layer, and a solid post about every 2.5 m (in the props layer).
 */
function fenceParts(lines: GeoJSON.Feature[]): { mesh: GeoJSON.FeatureCollection; posts: GeoJSON.Feature[] } {
  const mesh: GeoJSON.Feature[] = [], posts: GeoJSON.Feature[] = [];
  for (const f of lines) {
    const pts = (f.geometry as GeoJSON.LineString).coordinates;
    const top = Number(f.properties?.height) || 3;
    const [lng0, lat0] = pts[0];
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
    const ll = ([x, y]: number[]) => [lng0 + x / kx, lat0 + y / ky];
    const xy = pts.map(([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky]);
    const box = (c: number[], u: number[], hx: number, hy: number) =>
      [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => ll([c[0] + u[0] * hx * i - u[1] * hy * j, c[1] + u[1] * hx * i + u[0] * hy * j]));
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i], b = xy[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.1) continue;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      mesh.push({ type: 'Feature', properties: { base: 0, top }, geometry: { type: 'Polygon', coordinates: [box(mid, u, len / 2, 0.03)] } });
      const n = Math.max(1, Math.round(len / 2.5));
      for (let k = 0; k < n; k++) {
        const t = k / n, c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        posts.push({ type: 'Feature', properties: { part: 'post', base: 0, top: top + 0.05 }, geometry: { type: 'Polygon', coordinates: [box(c, u, 0.05, 0.05)] } });
      }
      // a top rail, so the mesh reads as a fence and not a pane of glass
      posts.push({ type: 'Feature', properties: { part: 'post', base: top - 0.06, top }, geometry: { type: 'Polygon', coordinates: [box(mid, u, len / 2 + 0.03, 0.035)] } });
    }
  }
  return { mesh: { type: 'FeatureCollection', features: mesh }, posts };
}

/**
 * The campus wall along Roehampton Lane and Clarence Lane (data/walls.geojson), low-poly and
 * well under the buildings: a dark plinth, a course of warm stone blocks in three tones and a
 * light coping that overhangs both faces; a thicker pier every ~17 m; a pillar wherever it
 * ends or opens; and at each named entrance a garden gate: two tall pillars with lanterns, an iron
 * double gate standing open into campus, and an iron arch between them.
 * Everything is one source and one extrusion layer, so it draws in a single batch per tile.
 */
const WALL = { plinthHalf: 0.9, plinth: 0.32, half: 0.72, course: 1.68, block: 4.2, copeHalf: 0.94, cope: 2.28 };
function wallParts(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  type Pt = number[];
  // a stable pseudo-random stone colour, so the wall looks the same on every visit
  const tone = (x: number, y: number) => Math.floor((Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 3);
  for (const f of fc.features) {
    const pr = f.properties ?? {};
    const g = f.geometry as GeoJSON.Point | GeoJSON.LineString;
    const first = (g.type === 'Point' ? g.coordinates : g.coordinates[0]) as LngLat;
    const [lng0, lat0] = first;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
    const toLL = ([x, y]: Pt): LngLat => [lng0 + x / kx, lat0 + y / ky];
    const local = ([lng, lat]: number[]): Pt => [(lng - lng0) * kx, (lat - lat0) * ky];
    const put = (ring: Pt[], part: string, base: number, top: number, extra: Record<string, unknown> = {}) => {
      const r = ring.map(toLL);
      r.push(r[0]);
      out.push({ type: 'Feature', properties: { part, base, top, ...extra }, geometry: { type: 'Polygon', coordinates: [r] } });
    };
    /** a box centred on c, `hx` along direction `a` (radians) and `hy` across it */
    const box = (c: Pt, a: number, hx: number, hy = hx): Pt[] => {
      const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [c[0] + u[0] * hx * i + v[0] * hy * j, c[1] + u[1] * hx * i + v[1] * hy * j]);
    };
    const oct = (c: Pt, r: number): Pt[] => Array.from({ length: 8 }, (_, i) => [c[0] + r * Math.cos((i * Math.PI) / 4 + 0.39), c[1] + r * Math.sin((i * Math.PI) / 4 + 0.39)]);
    /** a square post: plinth, body and cap */
    const post = (c: Pt, a: number, body: number, height: number) => {
      put(box(c, a, body + 0.14), 'plinth', 0, WALL.plinth + 0.06);
      put(box(c, a, body), 'pier', WALL.plinth, height);
      put(box(c, a, body + 0.17), 'cope', height, height + 0.3);
    };

    if (g.type === 'Point') {
      const c = local(g.coordinates), a = Number(pr.angle) || 0;
      if (pr.part === 'pier') post(c, a, 0.92, 2.5);
      if (pr.part === 'pillar') post(c, a, 1, 2.9);
      continue;
    }
    const pts = g.coordinates.map(local);

    if (pr.part === 'railing') { // a plain gate, shut: iron bars between two rails
      const [A, B] = pts;
      const span = Math.hypot(B[0] - A[0], B[1] - A[1]), a = Math.atan2(B[1] - A[1], B[0] - A[0]);
      const n = Math.max(3, Math.round((span - 1.6) / 0.42));
      for (let j = 0; j <= n; j++) {
        const t = 0.8 + ((span - 1.6) * j) / n, c = [A[0] + Math.cos(a) * t, A[1] + Math.sin(a) * t];
        put(box(c, a, 0.08), 'iron', 0.12, 1.9);
        put(box(c, a, 0.045), 'iron', 1.9, 2.08);
      }
      for (const [b0, b1] of [[0.3, 0.42], [1.66, 1.78]]) put(box([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], a, span / 2 - 0.7, 0.06), 'iron', b0, b1);
      continue;
    }
    if (pr.part === 'gate') {
      const [A, B] = pts;
      const span = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const d = [(B[0] - A[0]) / span, (B[1] - A[1]) / span], left = [-d[1], d[0]];
      const inward = [left[0] * (Number(pr.in) || 1), left[1] * (Number(pr.in) || 1)];
      const a = Math.atan2(d[1], d[0]);
      const at = (p: Pt, k: number, q = d): Pt => [p[0] + q[0] * k, p[1] + q[1] * k];
      const SHAFT = 1, TOP = 3.8;
      const pa = at(A, -0.4), pb = at(B, 0.4); // the pillars stand over the wall ends
      for (const c of [pa, pb]) {
        put(box(c, a, SHAFT + 0.25), 'plinth', 0, 0.55);
        put(box(c, a, SHAFT), 'pier', 0.55, TOP);
        put(box(c, a, SHAFT + 0.28), 'cope', TOP, TOP + 0.32);
        put(box(c, a, SHAFT - 0.15), 'cope', TOP + 0.32, TOP + 0.48);
        // a little lantern on top
        put(oct(c, 0.34), 'iron', TOP + 0.48, TOP + 0.6);
        put(oct(c, 0.26), 'lamp', TOP + 0.6, TOP + 1.05);
        put(oct(c, 0.37), 'iron', TOP + 1.05, TOP + 1.17);
        put(oct(c, 0.1), 'iron', TOP + 1.17, TOP + 1.37);
      }
      // the double gate, both leaves standing open into campus
      const ha = at(pa, SHAFT), hb = at(pb, -SHAFT);
      const opening = Math.hypot(hb[0] - ha[0], hb[1] - ha[1]);
      const leaf = opening / 2 - 0.05, swing = (68 * Math.PI) / 180;
      for (const [h, along] of [[ha, 1], [hb, -1]] as const) {
        const q = [d[0] * along * Math.cos(swing) + inward[0] * Math.sin(swing), d[1] * along * Math.cos(swing) + inward[1] * Math.sin(swing)];
        const qa = Math.atan2(q[1], q[0]);
        const n = Math.max(4, Math.round(leaf / 0.42));
        for (let j = 0; j <= n; j++) {
          const t = j / n, c = at(h, 0.1 + (leaf - 0.2) * t, q);
          const top = 2.2 + 0.65 * Math.sin((t * Math.PI) / 2); // the tops rise to meet in the middle
          const edge = j === 0 || j === n;
          put(box(c, qa, edge ? 0.12 : 0.08), 'iron', 0.12, top);
          put(box(c, qa, 0.045), 'iron', top, top + 0.2); // spike
        }
        for (const [b0, b1] of [[0.3, 0.44], [1.92, 2.06]]) {
          put(box(at(h, leaf / 2, q), qa, leaf / 2, 0.06), 'iron', b0, b1);
        }
      }
      // an iron arch between the pillars
      const N = 12, arch = (x: number) => TOP - 0.25 + 1.05 * Math.sin(Math.PI * x);
      for (let k = 0; k < N; k++) {
        const x0 = k / N, x1 = (k + 1) / N, mid = at(ha, opening * ((x0 + x1) / 2));
        const y = arch((x0 + x1) / 2);
        put(box(mid, a, (opening / N) / 2 + 0.02, 0.07), 'iron', y - 0.08, y + 0.1);
      }
      continue;
    }

    // a piece of wall: plinth, blocks, coping (few, long blocks: cheap to draw on phones)
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const normal = (i: number) => { // left of segment i -> i+1
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };
    const seg = (d: number) => { let i = 0; while (i < pts.length - 2 && cum[i + 1] < d) i++; return i; };
    const pointAt = (d: number, side: number) => {
      const i = seg(d), t = (d - cum[i]) / (cum[i + 1] - cum[i] || 1), nn = normal(i);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t + nn[0] * side, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t + nn[1] * side];
    };
    const mitre = (i: number, side: number) => { // offset corner at vertex i
      const n1 = normal(i - 1), n2 = normal(i), m = [n1[0] + n2[0], n1[1] + n2[1]], l = Math.hypot(m[0], m[1]) || 1;
      const k = Math.min(side / Math.max((m[0] * n1[0] + m[1] * n1[1]) / l, 0.33), side * 3);
      return [pts[i][0] + (m[0] / l) * k, pts[i][1] + (m[1] / l) * k];
    };
    /** the band of wall between d0 and d1 metres along the line */
    const band = (d0: number, d1: number, half: number) => {
      const inner = pts.map((_, i) => i).filter((i) => i > 0 && i < pts.length - 1 && cum[i] > d0 && cum[i] < d1);
      const l = [pointAt(d0, half), ...inner.map((i) => mitre(i, half)), pointAt(d1, half)];
      const r = [pointAt(d0, -half), ...inner.map((i) => mitre(i, -half)), pointAt(d1, -half)];
      return [...l, ...r.reverse()];
    };
    put(band(0, L, WALL.plinthHalf), 'plinth', 0, WALL.plinth);
    const nBlocks = Math.max(1, Math.round(L / WALL.block));
    for (let k = 0; k < nBlocks; k++) {
      const d0 = (L * k) / nBlocks, d1 = (L * (k + 1)) / nBlocks, mid = pointAt((d0 + d1) / 2, 0);
      put(band(d0, d1, WALL.half), 'stone', WALL.plinth, WALL.plinth + WALL.course, { tone: tone(mid[0] + lng0 * 1e4, mid[1]) });
    }
    put(band(0, L, WALL.copeHalf), 'cope', WALL.plinth + WALL.course, WALL.cope);
  }
  return { type: 'FeatureCollection', features: out };
}

export function createMap(opts: {
  container: string | HTMLElement;
  campus: GeoJSON.FeatureCollection;
  walls?: GeoJSON.FeatureCollection;
  bounds: [number, number, number, number];
  theme: Theme;
  interactive?: boolean;
}): MLMap {
  const { campus, bounds, theme } = opts;
  const walls = opts.walls ?? { type: 'FeatureCollection', features: [] };
  const byLayer = (l: string) => ({ type: 'FeatureCollection', features: campus.features.filter((f) => f.properties?.layer === l) }) as GeoJSON.FeatureCollection;
  // each building carries its roof type (src/roofs.ts) so the layers can style by it
  const buildings = byLayer('building');
  const halfLayer = byLayer('half');
  const fences = fenceParts(byLayer('fence').features);
  halves = halfLayer.features.map((f) => ({ id: f.properties!.osmId, block: f.properties!.block, ring: (f.geometry as GeoJSON.Polygon).coordinates[0] as LngLat[] }));
  halfLayer.features = halfLayer.features.map((f) => ({ ...f, geometry: { type: 'Polygon', coordinates: [grown((f.geometry as GeoJSON.Polygon).coordinates[0] as LngLat[], 0.12)] } }));
  buildings.features = buildings.features.map((f) => ({ ...f, properties: { ...f.properties, roof: ROOFS[f.properties?.osmId] ?? 'flat' } }));
  const [w, s, e, n] = bounds;
  // a big frame around campus, so the edge of the world reads as "off the map"
  const pad = 0.02;
  const outside: GeoJSON.Feature = {
    type: 'Feature', properties: {},
    geometry: { type: 'Polygon', coordinates: [
      [[w - pad, s - pad], [e + pad, s - pad], [e + pad, n + pad], [w - pad, n + pad], [w - pad, s - pad]],
      [[w, s], [w, n], [e, n], [e, s], [w, s]],
    ] },
  };

  const style: StyleSpecification = {
    version: 8,
    sources: {
      // the wall's ground line rides in the path layers (no extra layer): from afar it is a thin
      // stone-coloured line, close up it sits under the 3D wall
      campus: { type: 'geojson', data: { ...campus, features: [...campus.features, ...walls.features.filter((f) => f.properties?.part === 'wall').map((f) => ({ ...f, properties: { layer: 'path', kind: 'wall' } }))] }, promoteId: 'osmId' },
      buildings: { type: 'geojson', data: buildings, promoteId: 'osmId' },
      roofparts: { type: 'geojson', data: roofParts(buildings), promoteId: 'osmId' },
      halves: { type: 'geojson', data: halfLayer, promoteId: 'osmId' },
      trees: { type: 'geojson', data: treePolygons(byLayer('tree').features) },
      wallparts: { type: 'geojson', data: wallParts(walls) },
      props: { type: 'geojson', data: { type: 'FeatureCollection', features: [...carParts(byLayer('car').features).features, ...fountainParts(byLayer('fountain').features).features, ...fences.posts] } },
      fence: { type: 'geojson', data: fences.mesh },
      outside: { type: 'geojson', data: outside },
      user: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      hop: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'background', type: 'background', paint: {} },
      { id: 'green', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'green'], paint: {} },
      { id: 'pitch', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'pitch'], paint: {} },
      { id: 'parking', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'parking'], paint: {} },
      // tennis court markings on the MUGA (about 5 cm lines, so they only show up close)
      {
        id: 'courtline', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'courtline'], minzoom: 16.5,
        paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 16.5, 0.6, 19.5, 3] },
      },
      { id: 'water', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'water'], paint: {} },
      { id: 'shore', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'water'], paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 5], 'line-blur': 1 } },
      { id: 'waterway', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'waterway'], paint: { 'line-width': 3 } },
      {
        id: 'road-edge', type: 'line', source: 'campus',
        filter: ['==', ['get', 'layer'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15,
            ['match', ['get', 'kind'], 'footpath', 3, 'service', 3.5, 'wall', 3.6, 4.5], 19,
            ['match', ['get', 'kind'], 'footpath', 15, 'service', 21, 'wall', 8, 30]],
        },
      },
      {
        id: 'road', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15,
            ['match', ['get', 'kind'], 'footpath', 1.7, 'service', 2, 'wall', 2.2, 3], 19,
            ['match', ['get', 'kind'], 'footpath', 12, 'service', 18, 'wall', 6, 26]],
        },
      },
      { id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-opacity': 0.85 } },
      // the campus wall sits under the route, the labels and the pins
      {
        id: 'wall-3d', type: 'fill-extrusion', source: 'wallparts', minzoom: 16.8,
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-vertical-gradient': true },
      },
      { id: 'route-hop', type: 'line', source: 'hop', layout: { 'line-cap': 'round' }, paint: { 'line-width': 3, 'line-opacity': 0.6, 'line-dasharray': [0.5, 2] } },
      { id: 'route-case', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 13] } },
      { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3.5, 19, 8] } },
      // light dashes that drift towards the destination (animated in main.ts, full motion only)
      {
        id: 'route-flow', type: 'line', source: 'route', layout: { 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 3.5], 'line-opacity': 0, 'line-dasharray': [0, 4, 3] },
      },
      { id: 'accuracy', type: 'fill', source: 'user', paint: { 'fill-opacity': 0.14 } },
      { id: 'accuracy-line', type: 'line', source: 'user', paint: { 'line-width': 1.5, 'line-opacity': 0.5 } },
      { id: 'building-shadow', type: 'fill', source: 'buildings', paint: { 'fill-translate': [4, 4], 'fill-antialias': false } },
      // the selected building gets a soft coloured ring on the ground around its footprint
      {
        id: 'building-halo', type: 'line', source: 'buildings', layout: { 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 9], 'line-blur': 1.5, 'line-opacity': ['case', SELECTED, 0.9, 0] },
      },
      {
        id: 'building-walls', type: 'fill-extrusion', source: 'buildings',
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true },
      },
      {
        id: 'building-roof', type: 'fill-extrusion', source: 'buildings',
        paint: { 'fill-extrusion-height': RIM, 'fill-extrusion-base': ['+', HEIGHT, BOUNCE], 'fill-extrusion-opacity': 1 },
      },
      {
        id: 'building-top', type: 'fill-extrusion', source: 'roofparts',
        filter: TOP_FILTER,
        paint: {
          'fill-extrusion-height': ['+', ['get', 'h'], ['get', 'top'], BOUNCE],
          'fill-extrusion-base': ['+', ['get', 'h'], ['get', 'base'], BOUNCE],
          'fill-extrusion-opacity': 1,
        },
      },
      // solar panels: rows of cells (pattern image added on load)
      {
        id: 'roof-solar', type: 'fill-extrusion', source: 'roofparts',
        filter: SOLAR_FILTER,
        paint: {
          'fill-extrusion-height': ['+', ['get', 'h'], ['get', 'top'], BOUNCE],
          'fill-extrusion-base': ['+', ['get', 'h'], ['get', 'base'], BOUNCE],
          'fill-extrusion-pattern': 'solar-cells',
        },
      },
      // the selected half of a split block (selectBuilding): walls and roof in the selection colours
      {
        id: 'half-walls', type: 'fill-extrusion', source: 'halves', filter: inIds([]),
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE], 'fill-extrusion-base': 0, 'fill-extrusion-vertical-gradient': true },
      },
      {
        id: 'half-roof', type: 'fill-extrusion', source: 'halves', filter: inIds([]),
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE, ROOF + 0.75], 'fill-extrusion-base': ['+', HEIGHT, BOUNCE] },
      },
      // buildings standing between you and the route turn see-through while it shows (setXray)
      {
        id: 'building-ghost', type: 'fill-extrusion', source: 'buildings', filter: inIds([]),
        paint: { 'fill-extrusion-height': RIM, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.42, 'fill-extrusion-vertical-gradient': false },
      },
      // parked cars and the fountain: close up only, and never in the way of a tap (main.ts only asks the building layers)
      {
        id: 'props', type: 'fill-extrusion', source: 'props', minzoom: 16.5,
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'] },
      },
      // wire mesh: see-through, so it goes in its own layer with a layer-wide opacity
      {
        id: 'fence-mesh', type: 'fill-extrusion', source: 'fence', minzoom: 16.5,
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.22 },
      },
      {
        id: 'tree-trunk', type: 'fill-extrusion', source: 'trees', filter: ['==', ['get', 'part'], 'trunk'],
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'] },
      },
      {
        id: 'tree-leaf', type: 'fill-extrusion', source: 'trees', filter: ['==', ['get', 'part'], 'leaf'],
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'] },
      },
    ],
    light: { anchor: 'map', position: [1.4, 200, 35], intensity: 0.4, color: '#fff8ec' },
  };
  // fill in theme colours before the first render
  const paints = themedPaint(PALETTE[theme]);
  for (const layer of style.layers) Object.assign((layer as { paint: Record<string, unknown> }).paint ??= {}, paints[layer.id] ?? {});

  const map = new maplibregl.Map({
    container: opts.container,
    style,
    bounds: [w, s, e, n],
    fitBoundsOptions: { padding: 10 },
    // room to pan a little past the edge, so places near it can sit mid-screen above a panel
    maxBounds: [w - 0.006, s - 0.004, e + 0.006, n + 0.004],
    pitch: 55,
    maxPitch: 65,
    minZoom: 14.5, // the whole campus fits a phone held upright at about 14.9
    maxZoom: 19.5,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: false,
    interactive: opts.interactive ?? true,
    fadeDuration: 0,
    pixelRatio: Math.min(devicePixelRatio || 1, 2), // sharp enough, cheaper on 3x phones
  });
  map.touchPitch.disable();
  currentTheme = theme;
  // pattern images are drawn on demand, so the first frame never asks for a missing one
  map.setMissingStyleImageResolver((id) => {
    if (id === 'solar-cells' || id === 'win' || id === 'win-off') setWindowImages(map, PALETTE[currentTheme]);
  });
  map.once('load', () => {
    setWindowImages(map, PALETTE[currentTheme]);
    updateWindows(map);
    map.on('zoomend', () => updateWindows(map));
  });
  return map;
}

type PaintArgs = Parameters<MLMap['setPaintProperty']>;
let currentTheme: Theme = 'light';
export function applyTheme(map: MLMap, theme: Theme) {
  currentTheme = theme;
  // (map.loaded() reads false while the route dashes animate, so check for the images instead)
  if (map.hasImage('win') || map.hasImage('solar-cells')) setWindowImages(map, PALETTE[theme]);
  const paints = themedPaint(PALETTE[theme]);
  for (const [layer, props] of Object.entries(paints)) {
    if (!map.getLayer(layer)) continue;
    for (const [k, v] of Object.entries(props)) map.setPaintProperty(layer, k as PaintArgs[1], v as PaintArgs[2]);
  }
}

/** A short, non-blocking hop of one building (feature-state animated over ~450 ms). */
export function bounceBuilding(map: MLMap, osmId: string) {
  const start = performance.now();
  const tick = (t: number) => {
    const k = Math.min(1, (t - start) / 450);
    const v = Math.sin(k * Math.PI) * (1 - k * 0.4);
    for (const source of isHalf(osmId) ? ['halves'] : ['buildings', 'roofparts']) map.setFeatureState({ source, id: osmId }, { bounce: k < 1 ? v : 0 });
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let selectedId: string | null = null;
export function selectBuilding(map: MLMap, osmId: string | null) {
  if (selectedId) for (const source of ['buildings', 'roofparts']) map.setFeatureState({ source, id: selectedId }, { selected: false });
  selectedId = osmId;
  // half of a split block: only that half lights up, drawn over the block
  const half = isHalf(osmId);
  for (const id of ['half-walls', 'half-roof']) if (map.getLayer(id)) map.setFilter(id, inIds(half && osmId ? [osmId] : []));
  if (osmId && !half) for (const source of ['buildings', 'roofparts']) map.setFeatureState({ source, id: osmId }, { selected: true });
}

/**
 * See-through mode: the given buildings leave the solid layers and are drawn as one pale,
 * glassy block instead, so a route behind them stays visible. An empty list puts everything back.
 */
let xray = '';
export function setXray(map: MLMap, ids: string[]) {
  // a split block is one building on the map: see through all of it
  const blocks = new Set(halves.filter((h) => ids.includes(h.id)).map((h) => h.block));
  const sorted = [...new Set([...ids, ...halves.filter((h) => blocks.has(h.block)).map((h) => h.id)])].sort();
  const key = sorted.join(',');
  if (key === xray || !map.getLayer('building-ghost')) return;
  xray = key;
  const out: Expr = ['!', inIds(sorted)];
  const any = sorted.length > 0;
  map.setFilter('building-walls', any ? out : null);
  map.setFilter('building-roof', any ? out : null);
  map.setFilter('building-top', any ? ['all', TOP_FILTER, out] : TOP_FILTER);
  map.setFilter('roof-solar', any ? ['all', SOLAR_FILTER, out] : SOLAR_FILTER);
  map.setFilter('building-ghost', inIds(sorted));
}

export function setGeoJSON(map: MLMap, source: 'user' | 'route' | 'hop', data: GeoJSON.Feature | GeoJSON.FeatureCollection) {
  (map.getSource(source) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

export const lineFeature = (coords: LngLat[]): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

/** Trees standing on or right beside a route are hidden while it shows, so the line stays readable. */
export function clearTreesAlong(map: MLMap, line: LngLat[] | null, metres = 7) {
  const hide: number[] = [];
  if (line && line.length > 1) {
    const k = 111320, cos = Math.cos((line[0][1] * Math.PI) / 180);
    const xy = (p: LngLat) => [p[0] * k * cos, p[1] * k];
    const segs = line.slice(1).map((b, i) => [xy(line[i]), xy(b)]);
    treeCenters.forEach((c, t) => {
      const [px, py] = xy(c);
      for (const [[ax, ay], [bx, by]] of segs) {
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const u = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
        if (Math.hypot(px - ax - u * dx, py - ay - u * dy) < metres) { hide.push(t); return; }
      }
    });
  }
  for (const id of ['tree-trunk', 'tree-leaf']) {
    const part = id === 'tree-trunk' ? 'trunk' : 'leaf';
    map.setFilter(id, hide.length
      ? ['all', ['==', ['get', 'part'], part], ['!', ['in', ['get', 't'], ['literal', hide]]]]
      : ['==', ['get', 'part'], part]);
  }
}
