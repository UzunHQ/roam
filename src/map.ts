import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import { type ExpressionSpecification as Expr, type LayerSpecification, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { LngLat } from './types';
import { ROOFS, isPitched } from './roofs';

// maplibre-gl 6 looks for its worker next to its own module, which Vite bundles away; point it at the emitted file.
maplibregl.setWorkerUrl(workerUrl);

export type Theme = 'light' | 'dark';
/** main.ts loads this module on demand and takes MapLibre from here */
export { maplibregl };

import { PALETTE, cssVars, type Pal } from './theme/mapColors';


// Queen Mary's Hospital (scripts/build-context.mjs marks it): a light roof with a red edge, so it reads
// as the hospital and never as a campus building
const HOSPITAL: Expr = ['coalesce', ['get', 'hospital'], false];
const roofColor = (p: Pal): Expr => [
  'case', HOSPITAL, p.hospRoof, ['!', ['coalesce', ['get', 'campus'], true]], p.offRoof,
  ['match', ['get', 'college'],
    'digby-stuart', p.digbyRoof,
    'froebel', p.froebelRoof,
    'southlands', p.southlandsRoof,
    'whitelands', p.whitelandsRoof,
    p.otherRoof],
];
const rimColor = (p: Pal): Expr => [
  'case', HOSPITAL, p.hospRim, ['!', ['coalesce', ['get', 'campus'], true]], p.offRim,
  ['match', ['get', 'college'],
    'digby-stuart', p.digbyRim,
    'froebel', p.froebelRim,
    'southlands', p.southlandsRim,
    'whitelands', p.whitelandsRim,
    p.otherRim],
];
/** Roof parts: flat panels keep the college pastel; pitched roofs are slate or tile in three steps. */
const partColor = (p: Pal): Expr => ['match', ['get', 'part'],
  'panel', ['match', ['get', 'kind'], 'metal', p.metal, roofColor(p)],
  'patch', p.greenRoof,
  'p1', ['match', ['get', 'kind'], 'tile', p.tile1, p.slate1],
  'p2', ['match', ['get', 'kind'], 'tile', p.tile2, p.slate2],
  ['match', ['get', 'kind'], 'tile', p.tile3, p.slate3],
];
const wallColor = (p: Pal): Expr => ['case', ['coalesce', ['get', 'campus'], true], p.wall, p.wallOff];
const SELECTED: Expr = ['boolean', ['feature-state', 'selected'], false];
/** outside the university's own ground (build-context.mjs sets `ctx`): drawn in the surroundings' plain colours */
const CTX: Expr = ['coalesce', ['get', 'ctx'], false];
// layer filters, kept here so see-through mode (setXray) can add to them and put them back
const TOP_FILTER: Expr = ['!', ['in', ['get', 'part'], ['literal', ['cells', 'solar']]]];
const SOLAR_FILTER: Expr = ['==', ['get', 'part'], 'cells'];
const SOLAR_FAR_FILTER: Expr = ['==', ['get', 'part'], 'solar'];
/** below this zoom the gaps between panel rows are thinner than a pixel and would shimmer, so the area is drawn whole */
const SOLAR_ROWS_ZOOM = 17.5;
const inIds = (ids: string[]): Expr => ['in', ['get', 'osmId'], ['literal', ids]];

// chunky: unknown heights become 2-3 storeys; known ones are kept
const HEIGHT: Expr = ['coalesce', ['get', 'height'], ['match', ['get', 'building'], ['house', 'detached', 'shed', 'garage'], 6, 9]];
const BOUNCE: Expr = ['*', ['coalesce', ['feature-state', 'bounce'], 0], 5];
const ROOF = 1.2; // parapet: full footprint, in the college's rim colour (a low 0.5 m eave on pitched roofs)
// solar panels stand clear of the roof below, so the two never fight over the same depth at any zoom
const SOLAR = { base: ROOF + 0.45, top: ROOF + 0.8, row: 1.6, gap: 0.7, length: 5, joint: 0.25, edge: 0.4 };
const RIM: Expr = ['+', HEIGHT, BOUNCE, ['match', ['get', 'roof'], ['slate', 'tile'], 0.5, ROOF]];

/** Paint properties that change with the theme, applied on load and on theme switch. */
function themedPaint(p: Pal): Record<string, Record<string, unknown>> {
  return {
    // the surroundings' plain ground everywhere; the university's own ground (layer "campusground") is green
    background: { 'background-color': p.bg },
    'campus-ground': { 'fill-color': p.ground },
    outside: { 'fill-color': p.outside },
    'zone-fade': { 'line-color': p.outside },
    // every lawn, meadow and wood in one green, so neighbouring OSM areas don't show as patches; sports fields stand out
    green: { 'fill-color': ['case', CTX, p.ctx.green, ['coalesce', ['get', 'field'], false], p.pitch, p.wood] },
    // the plots across the roads (an estate, a school's grounds): plain, with a thin edge
    lot: { 'fill-color': p.ctx.lot, 'fill-outline-color': p.ctx.lotEdge },
    pitch: { 'fill-color': p.pitch, 'fill-outline-color': p.pitchLine },
    parking: { 'fill-color': ['case', CTX, p.ctx.parking, p.parking] }, // on campus a shade darker than the roads, so the aisles read (as at the hospital)
    // the golf course beside the campus isn't the university's: its own soft, grey-green tones
    golf: { 'fill-color': ['match', ['get', 'kind'], 'fairway', p.ctx.golf.fairway, 'tee', p.ctx.golf.tee, 'green', p.ctx.golf.green, 'bunker', p.ctx.golf.bunker, 'water', p.ctx.golf.water, p.ctx.golf.rough] },
    // painted lines: the courts' and pitches', and the campus car parks' bays in road paint (the hospital's stay as they were)
    courtline: { 'line-color': ['case', ['all', ['coalesce', ['get', 'bay'], false], ['!', CTX]], p.bayLine, p.pitchLine] },
    'fence-mesh': { 'fill-extrusion-color': p.fenceMesh },
    monument: { 'fill-extrusion-color': ['match', ['get', 'part'], 'roof', p.stoneRoof, 'base', p.stoneDark, 'band', p.stoneDark, p.stone] },
    water: { 'fill-color': ['case', CTX, p.ctx.water, p.water] },
    shore: { 'line-color': ['case', CTX, p.ctx.water, p.shore] },
    waterway: { 'line-color': ['case', CTX, p.ctx.water, p.water] },
    'road-edge': { 'line-color': ['match', ['get', 'kind'], 'footpath', ['case', CTX, p.ctx.footpathEdge, p.footpathEdge], 'wall', p.plinth, ['case', CTX, p.ctx.roadEdge, p.roadEdge]] },
    road: { 'line-color': ['match', ['get', 'kind'], 'footpath', ['case', CTX, p.ctx.footpath, p.footpath], 'wall', p.stones[1], ['case', CTX, p.ctx.road, p.road]] },
    'building-walls': { 'fill-extrusion-color': ['case', SELECTED, p.selectedWall, wallColor(p)] },
    'building-roof': { 'fill-extrusion-color': ['case', SELECTED, p.selected, rimColor(p)] },
    'building-top': { 'fill-extrusion-color': ['case', SELECTED, p.selected, partColor(p)] },
    'roof-solar': { 'fill-extrusion-color': p.solar },
    'roof-solar-far': { 'fill-extrusion-color': p.solar },
    ...Object.fromEntries(FLAG_SIZES.map(({ k }) => [`golfflag-${k}`, { 'fill-extrusion-color': ['match', ['get', 'part'], 'flag', p.flag, p.goalPost] }])),
    'building-ghost': { 'fill-extrusion-color': ['case', SELECTED, p.selected, roofColor(p)] },
    // trees outside the university's ground: one pale sage (see-through over the plain ground)
    'tree-trunk': { 'fill-extrusion-color': ['case', CTX, p.ctx.stem, p.trunk] },
    'tree-leaf': { 'fill-extrusion-color': ['case', CTX, p.ctx.leaf, ['match', ['get', 'tone'], 0, p.tones[0], 1, p.tones[1], 2, p.tones[2], 3, p.tones[3], 4, p.tones[4], p.blossom]] },
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
        'plinth', p.plinthStone, 'figure', p.bronze, 'iron', p.iron, 'soil', p.soil, 'goal', p.goalPost, 'flag', p.flag, 'bench', p.benchWood, 'busglass', p.busGlass, 'busroof', p.busRoof, 'buspole', p.busPole, 'busflag', p.busFlag, 'coopwall', p.coopWood, 'ramp', p.coopWood, 'cooproof', p.coopRoof, 'hen', p.hen, 'comb', p.comb,
        'bloom', ['match', ['get', 'c'], 0, p.blooms[0], 1, p.blooms[1], 2, p.blooms[2], p.blooms[3]],
        ['match', ['get', 'c'], 0, p.cars[0], 1, p.cars[1], 2, p.cars[2], 3, p.cars[3], 4, p.cars[4], p.cars[5]]],
    },
  };
}

let treeCenters: LngLat[] = [];
/**
 * Small details (cars, pitch and court lines, goals, fences, the garden, statue, fountain, benches,
 * golf flags) show from here: just under the farthest the map zooms out (14.5), so they are already
 * there in the opening and whole-campus views, which go down to about 14.9 on a phone.
 */
const DETAIL_ZOOM = 14.4;

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
 * Solar panels filling an area of roof: rows lined up with the area's longest edge, each row cut
 * into panels about 5 m long. Real boxes instead of a pattern image, so they keep their size and
 * stay still at every zoom. `area` is a closed ring in lng/lat; returns closed rings.
 */
function solarRows(area: LngLat[]): LngLat[][] {
  const ring = area.slice(0, -1);
  const lat0 = ring[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
  const pts = ring.map(([x, y]) => [x * kx, y * ky]);
  let best = 0, ang = 0;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > best) { best = l; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); } });
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const rot = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  const back = ([x, y]: number[]): LngLat => [(x * Math.cos(ang) - y * Math.sin(ang)) / kx, (x * Math.sin(ang) + y * Math.cos(ang)) / ky];
  // where a horizontal line crosses the outline: inside intervals, left to right
  const span = (y: number) => {
    const xs: number[] = [];
    rot.forEach((p, i) => {
      const q = rot[(i + 1) % rot.length];
      if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    });
    xs.sort((a, b) => a - b);
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
  };
  const ys = rot.map((p) => p[1]);
  const out: LngLat[][] = [];
  for (let y0 = Math.min(...ys) + SOLAR.edge; y0 + SOLAR.row <= Math.max(...ys) - SOLAR.edge; y0 += SOLAR.row + SOLAR.gap) {
    const y1 = y0 + SOLAR.row;
    // the part of the row inside the area along both of its long edges
    for (const [a0, a1] of span(y0)) {
      for (const [b0, b1] of span(y1)) {
        const x0 = Math.max(a0, b0) + SOLAR.edge, x1 = Math.min(a1, b1) - SOLAR.edge;
        if (x1 - x0 < 1.5) continue;
        const n = Math.max(1, Math.round((x1 - x0) / SOLAR.length)), step = (x1 - x0) / n;
        for (let k = 0; k < n; k++) {
          const p0 = x0 + k * step, p1 = p0 + step - SOLAR.joint;
          const r = [[p0, y0], [p1, y0], [p1, y1], [p0, y1], [p0, y0]].map(back);
          out.push(r);
        }
      }
    }
  }
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
      // courtyards (a multipolygon's inner rings) stay open through the flat roof panel
      const holes = part === 'panel' ? (f.geometry as GeoJSON.Polygon).coordinates.slice(1) : [];
      if (poly) out.push({ type: 'Feature', properties: { osmId: pr.osmId, college: pr.college, campus: pr.campus, hospital: pr.hospital ?? false, kind, h, part, base, top }, geometry: { type: 'Polygon', coordinates: [poly, ...holes] } });
      return !!poly;
    };
    if (isPitched(kind)) {
      if (add(1.2, 'p1', 0.5, 1.7) && add(2.7, 'p2', 1.7, 2.8)) add(4.2, 'p3', 2.8, 3.7);
    } else {
      add(1, 'panel', ROOF, ROOF + 0.45);
      // planted area or solar panels: as far in as the outline allows
      const area = [3.5, 2.5, 1.6].map((d) => inset(ring, d)).find(Boolean) ?? innerRect(ring, 5);
      if (kind === 'green' && area) out.push({ type: 'Feature', properties: { osmId: pr.osmId, college: pr.college, campus: pr.campus, hospital: pr.hospital ?? false, kind, h, part: 'patch', base: ROOF + 0.45, top: ROOF + 0.6 }, geometry: { type: 'Polygon', coordinates: [area] } });
      if (kind === 'solar' && area) {
        out.push({ type: 'Feature', properties: { osmId: pr.osmId, college: pr.college, campus: pr.campus, hospital: pr.hospital ?? false, kind, h, part: 'solar', base: SOLAR.base, top: SOLAR.top }, geometry: { type: 'Polygon', coordinates: [area] } });
        const lng0 = area[0][0], lat0 = area[0][1];
        const local = area.map(([x, y]) => [x - lng0, y - lat0] as LngLat); // rows are laid out near 0,0, then moved back
        for (const r of solarRows(local)) {
          out.push({ type: 'Feature', properties: { osmId: pr.osmId, college: pr.college, campus: pr.campus, hospital: pr.hospital ?? false, kind, h, part: 'cells', base: SOLAR.base, top: SOLAR.top }, geometry: { type: 'Polygon', coordinates: [r.map(([x, y]) => [x + lng0, y + lat0])] } });
        }
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
// The same tile twice: full size close up, and at half size ("-s", pixel ratio 4) from further out,
// so the overview has rows of small windows instead of a few big ones (or none)
const WINDOW_IMAGES = ['win', 'win-off', 'win-hosp', 'win-s', 'win-off-s', 'win-hosp-s'];
function setWindowImages(map: MLMap, p: Pal) {
  const on = windowTile(p.wall, p.frame, p.glass), off = windowTile(p.wallOff, p.frameOff, p.glassOff), hosp = windowTile(p.hospWall, p.frame, p.hospGlass);
  for (const [id, data, ratio] of [['win', on, 2], ['win-off', off, 2], ['win-hosp', hosp, 2], ['win-s', on, 4], ['win-off-s', off, 4], ['win-hosp-s', hosp, 4]] as const) {
    if (map.hasImage(id)) map.updateImage(id, data); else map.addImage(id, data, { pixelRatio: ratio });
  }
}
/** Windows show at every zoom: the small tile from afar, the full one once you're close. */
const WINDOW_ZOOM = 17.4;
const windowPattern = (near: boolean): Expr => ['case', HOSPITAL, near ? 'win-hosp' : 'win-hosp-s', ['coalesce', ['get', 'campus'], true], near ? 'win' : 'win-s', near ? 'win-off' : 'win-off-s'];
let windowsNear: boolean | null = null;
function updateWindows(map: MLMap) {
  const near = map.getZoom() >= WINDOW_ZOOM;
  if (near === windowsNear) return;
  windowsNear = near;
  map.setPaintProperty('building-walls', 'fill-extrusion-pattern', windowPattern(near));
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
    // the tree wall along the golf course (belt): only the two darkest greens, never blossom
    const tone = f.properties?.belt ? (h < 0.5 ? 3 : 1) : h < 0.05 ? 5 : Math.floor((h * 100) % 5);
    const ctx = f.properties?.ctx === true;
    out.push({ type: 'Feature', properties: { t, ctx, part: 'trunk', base: 0, top: 2.2 * s }, geometry: ngon(c, 0.45 * s, rot, 6) });
    out.push({ type: 'Feature', properties: { t, ctx, tone, part: 'leaf', tier: 0, base: 2 * s, top: 3.4 * s }, geometry: ngon(c, 2.1 * s, rot, 8) });
    out.push({ type: 'Feature', properties: { t, ctx, tone, part: 'leaf', tier: 1, base: 3.4 * s, top: 5.6 * s }, geometry: ngon(c, 2.6 * s, rot + 0.2, 8) });
    out.push({ type: 'Feature', properties: { t, ctx, tone, part: 'leaf', tier: 2, base: 5.6 * s, top: 7.1 * s }, geometry: ngon(c, 1.7 * s, rot + 0.4, 8) });
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
 * The garden statue (layer "statue"): a stepped stone plinth, a low-poly figure (body, shoulders,
 * head) in bronze, and a knee-high iron fence round it, square to the garden (`a`, radians).
 * Flower beds (layer "flowerbed"): a low bed of soil with a mound of colour `c` on top.
 */
function gardenParts(statues: GeoJSON.Feature[], beds: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  const put = (part: string, base: number, top: number, ring: number[][], c = 0) =>
    out.push({ type: 'Feature', properties: { part, base, top, c }, geometry: { type: 'Polygon', coordinates: [ring] } });
  for (const f of statues) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const a = Number(f.properties?.a) || 0, u = [Math.cos(a), Math.sin(a)];
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const ll = (x: number, y: number) => [lng + x / kx, lat + y / ky];
    const box = (cx: number, cy: number, hx: number, hy = hx) =>
      [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => ll(cx + u[0] * hx * i - u[1] * hy * j, cy + u[1] * hx * i + u[0] * hy * j));
    const oct = (r: number) => Array.from({ length: 9 }, (_, i) => ll(r * Math.cos(((i % 8) * Math.PI) / 4 + a), r * Math.sin(((i % 8) * Math.PI) / 4 + a)));
    put('plinth', 0, 0.3, box(0, 0, 1.25));
    put('plinth', 0.3, 1.5, box(0, 0, 0.9));
    put('plinth', 1.5, 1.65, box(0, 0, 1.02));
    put('figure', 1.65, 2.9, oct(0.42)); // body
    put('figure', 2.9, 3.1, box(0, 0, 0.5, 0.22)); // shoulders
    put('figure', 3.1, 3.5, oct(0.22)); // head
    // the fence: a post every metre or so and two rails, 4.5 m out from the statue
    const R = 4.5, corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
    corners.forEach(([x0, y0], k) => {
      const [x1, y1] = corners[(k + 1) % 4];
      const n = 8;
      for (let j = 0; j < n; j++) {
        const t = j / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        put('iron', 0, 0.95, box(u[0] * x - u[1] * y, u[1] * x + u[0] * y, 0.04));
      }
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, along = Math.abs(x1 - x0) > 0.1;
      for (const [b0, b1] of [[0.18, 0.24], [0.85, 0.93]]) {
        const hx = along ? R + 0.04 : 0.03, hy = along ? 0.03 : R + 0.04;
        put('iron', b0, b1, box(u[0] * mx - u[1] * my, u[1] * mx + u[0] * my, hx, hy));
      }
    });
  }
  for (const f of beds) {
    const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
    const c = f.properties?.c ?? 0;
    put('soil', 0, 0.22, ring);
    // the blooms sit a little in from the bed's edge
    const mid = ring.slice(0, -1).reduce(([x, y], p) => [x + p[0] / (ring.length - 1), y + p[1] / (ring.length - 1)], [0, 0]);
    put('bloom', 0.22, 0.42, ring.map(([x, y]) => [mid[0] + (x - mid[0]) * 0.82, mid[1] + (y - mid[1]) * 0.82]), c);
  }
  return out;
}

/**
 * Historic monuments (layer "monument"): the Lyne-Stephens Mausoleum, a Greek cross of four equal
 * arms in grey stone, each arm under an equilateral gable (approximated by stepped slabs), on a low
 * base, with a carved band under the eaves. No windows and no college colour: it isn't a campus
 * building. `a` turns the cross, `span` is its overall size and `arm` the width of an arm (metres).
 */
function monumentParts(fs: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const f of fs.filter((x) => x.properties?.kind === 'mausoleum')) {
    const pr = f.properties ?? {};
    const [lng, lat] = pr.centre as number[];
    const a = Number(pr.a) || 0, S = Number(pr.span) || 9, A = Math.min(Number(pr.arm) || 5, S * 0.62), H = Number(pr.wall) || 4.5;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    const ll = (x: number, y: number) => [lng + (u[0] * x + v[0] * y) / kx, lat + (u[1] * x + v[1] * y) / ky];
    const rect = (hx: number, hy: number) => [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]].map(([x, y]) => ll(x, y));
    const cross = (s: number, w: number) => {
      const h = s / 2, q = w / 2;
      return [[q, -h], [q, -q], [h, -q], [h, q], [q, q], [q, h], [-q, h], [-q, q], [-h, q], [-h, -q], [-q, -q], [-q, -h], [q, -h]].map(([x, y]) => ll(x, y));
    };
    const put = (part: string, base: number, top: number, ring: number[][]) =>
      out.push({ type: 'Feature', properties: { part, base, top }, geometry: { type: 'Polygon', coordinates: [ring] } });
    put('base', 0, 0.45, cross(S + 0.5, A + 0.5)); // a stepped stone base
    put('wall', 0.45, H, cross(S, A));
    put('band', H - 0.45, H, cross(S + 0.16, A + 0.16)); // the carved band at the eaves
    // each arm's gable: an equilateral triangle on the arm's width, so the ridge stands A x 0.87
    // above the eaves; built as stepped slabs, both bars (along u and along v) crossing at the middle
    const steps = 5, rise = A * 0.87;
    for (let k = 0; k < steps; k++) {
      const w = (A + 0.3) * (1 - k / steps), b0 = H + (rise * k) / steps, b1 = H + (rise * (k + 1)) / steps;
      put('roof', b0, b1, rect((S + 0.3) / 2, w / 2));
      put('roof', b0, b1, rect(w / 2, (S + 0.3) / 2));
    }
  }
  return { type: 'FeatureCollection', features: out };
}

/**
 * Golf flags (layer "golfflag"), one on each green: a white pole with a red pennant near the top,
 * a triangle stepped out in three slices (extrusions can't slope). Extrusions are in metres and
 * would shrink to a dot from afar, so each flag comes in a few sizes (`k`, FLAG_SIZES) and each size
 * is drawn only in its own zoom band: big enough to read as a flag in the opening view, about real
 * size close up. The pole is thicker on the bigger ones, so it doesn't vanish either.
 */
// k: the flag's scale against real size (a 2.2 m pole, 0.9 m pennant); about 12-18 px of pennant on
// screen in every band, real size from zoom 18.5
const FLAG_SIZES = [
  { k: 20, from: 0, to: 15.5 },
  { k: 11, from: 15.5, to: 16.5 },
  { k: 5.5, from: 16.5, to: 17.5 },
  { k: 2.6, from: 17.5, to: 18.5 },
  { k: 1.3, from: 18.5, to: 24 },
];
function flagParts(points: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const f of points) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const sq = (x0: number, x1: number, h: number) => [[x0, -h], [x1, -h], [x1, h], [x0, h], [x0, -h]].map(([x, y]) => [lng + x / kx, lat + y / ky]);
    for (const { k } of FLAG_SIZES) {
      const pole = 0.055 * k; // about 2 px wide in every band
      out.push({ type: 'Feature', properties: { part: 'pole', k, base: 0, top: 2.2 * k }, geometry: { type: 'Polygon', coordinates: [sq(-pole, pole, pole)] } });
      // pennant: flies east from the pole, 0.9 m long at real size, taller at the pole
      [[0, 0.3, 0.3], [0.3, 0.6, 0.19], [0.6, 0.9, 0.08]].forEach(([x0, x1, h]) =>
        out.push({ type: 'Feature', properties: { part: 'flag', k, base: (1.95 - h) * k, top: (1.95 + h) * k }, geometry: { type: 'Polygon', coordinates: [sq(pole + x0 * k, pole + x1 * k, 0.03 * k)] } }));
    }
  }
  return out;
}

/** a bus stop on the pavement: where its shelter stands, which way the road runs and which side it is */
export type StopFrame = { at: LngLat; along: [number, number]; out: [number, number] };
/**
 * Where each bus stop's shelter goes: the stop's point (OpenStreetMap's, at the kerb or on the road),
 * moved out to the pavement on its side of the nearest road (layer "path", kind "road") and turned
 * to run along it. The pin stands on the shelter (main.ts).
 */
export function stopFrames(stops: LngLat[], campus: GeoJSON.FeatureCollection): StopFrame[] {
  // a bus runs on the main roads: those count first (a side street's corner can be nearer)
  const MAIN = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
  const all = campus.features.filter((f) => f.properties?.layer === 'path' && f.properties?.kind === 'road' && f.geometry.type === 'LineString');
  const lines = (main: boolean) => all.filter((f) => MAIN.has(f.properties?.highway) === main).map((f) => (f.geometry as GeoJSON.LineString).coordinates as LngLat[]);
  const mainRoads = lines(true), sideRoads = lines(false);
  return stops.map((at) => {
    const kx = 111320 * Math.cos((at[1] * Math.PI) / 180), ky = 111320;
    let best = { d: Infinity, along: [1, 0] as [number, number], out: [0, 1] as [number, number] };
    const near = (roads: LngLat[][]) => { for (const line of roads) for (let i = 0; i + 1 < line.length; i++) {
      const ax = (line[i][0] - at[0]) * kx, ay = (line[i][1] - at[1]) * ky;
      const bx = (line[i + 1][0] - at[0]) * kx, by = (line[i + 1][1] - at[1]) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      if (!L2) continue;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
      const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
      if (d >= best.d) continue;
      const L = Math.sqrt(L2), along: [number, number] = [dx / L, dy / L];
      // away from the road: from the nearest point on it towards the stop (or, on the road's line,
      // the left side, so it's at least consistent)
      const out: [number, number] = d > 0.3 ? [-px / d, -py / d] : [-along[1], along[0]];
      best = { d, along, out };
    } };
    near(mainRoads);
    if (best.d > 15) near(sideRoads);
    // the shelter's middle: about 6.5 m from the road's centre line (a lane, the kerb, then the
    // shelter on the pavement), or where the stop already is if it's farther out
    const push = best.d === Infinity ? 0 : Math.max(0, 6.5 - best.d);
    return { at: [at[0] + (best.out[0] * push) / kx, at[1] + (best.out[1] * push) / ky], along: best.along, out: best.out };
  });
}

/**
 * Bus stops: a shelter (glass back and ends, a thin roof, a bench inside) and, at its kerb-side
 * corner, the stop's pole with its red sign, low-poly like the benches.
 */
function busStopParts(frames: StopFrame[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const { at, along, out: o } of frames) {
    const kx = 111320 * Math.cos((at[1] * Math.PI) / 180), ky = 111320;
    // a box centred `a` metres along the road and `b` out from it, with half sizes ha and hb
    // (drawn a third larger than life, so it reads as a bus stop from the usual zoom)
    const S = 1.35;
    const box = (part: string, a: number, b: number, ha: number, hb: number, base: number, top: number) => out.push({
      type: 'Feature', properties: { part, base: base * S, top: top * S },
      geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => {
        const x = S * (along[0] * (a + ha * i) + o[0] * (b + hb * j)), y = S * (along[1] * (a + ha * i) + o[1] * (b + hb * j));
        return [at[0] + x / kx, at[1] + y / ky];
      })] },
    });
    box('busglass', 0, 0.62, 1.6, 0.05, 0.12, 2.2); // back, away from the road
    for (const s of [-1.58, 1.58]) box('busglass', s, 0.05, 0.04, 0.6, 0.12, 2.2); // ends
    for (const s of [-1.6, 1.6]) for (const t of [-0.6, 0.62]) box('buspole', s, t, 0.05, 0.05, 0, 2.25); // frame
    box('busroof', 0, 0, 1.78, 0.8, 2.22, 2.4);
    box('bench', 0, 0.36, 0.9, 0.16, 0.44, 0.5);
    box('buspole', 2.5, -0.55, 0.06, 0.06, 0, 3.1); // the stop's pole by the kerb
    box('busflag', 2.5, -0.55, 0.03, 0.26, 2.45, 2.95); // its sign, facing the traffic
  }
  return out;
}

/**
 * Park benches (layer "bench"): a wooden seat and backrest on two iron frames, 1.8 m long, facing `a`.
 */
function benchParts(points: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const f of points) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const a = Number(f.properties?.a) || 0, kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const fwd = [Math.cos(a), Math.sin(a)], side = [-fwd[1], fwd[0]];
    // a box `along` the bench (side) and `ahead` (fwd) of its centre, with half sizes
    const box = (part: string, along: number, ahead: number, hs: number, hf: number, base: number, top: number) => out.push({
      type: 'Feature', properties: { part, base, top },
      geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => {
        const x = side[0] * (along + hs * i) + fwd[0] * (ahead + hf * j), y = side[1] * (along + hs * i) + fwd[1] * (ahead + hf * j);
        return [lng + x / kx, lat + y / ky];
      })] },
    });
    for (const s of [-0.75, 0.75]) box('iron', s, 0, 0.04, 0.24, 0, 0.42); // legs
    box('bench', 0, 0, 0.9, 0.24, 0.42, 0.48); // seat
    box('bench', 0, -0.22, 0.9, 0.035, 0.55, 0.85); // backrest
    for (const s of [-0.75, 0.75]) box('iron', s, -0.22, 0.03, 0.03, 0.42, 0.85); // backrest posts
  }
  return out;
}

/**
 * Picnic tables (layer "picnic"): one wooden piece, a table top on two A-frame legs with a bench
 * along each side, 1.8 m long, turned by `a`.
 */
function picnicParts(points: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const f of points) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const a = Number(f.properties?.a) || 0, kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    const box = (x: number, y: number, hx: number, hy: number, base: number, top: number) => out.push({
      type: 'Feature', properties: { part: 'bench', base, top },
      geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => {
        const px = u[0] * (x + hx * i) + v[0] * (y + hy * j), py = u[1] * (x + hx * i) + v[1] * (y + hy * j);
        return [lng + px / kx, lat + py / ky];
      })] },
    });
    box(0, 0, 0.9, 0.38, 0.68, 0.75); // table top
    for (const s of [-0.7, 0.7]) box(s, 0, 0.05, 0.78, 0, 0.68); // legs (A-frames, from above a bar across)
    for (const y of [-0.68, 0.68]) box(0, y, 0.9, 0.14, 0.4, 0.46); // benches
  }
  return out;
}

/**
 * The Growhampton chicken coop (a "monument" of kind coop): a small wooden hen house on short legs,
 * `long` x `wide` metres turned by `a`, under a reddish pitched roof (stepped slabs along the ridge,
 * eaves overhanging), with a little ramp up to a hatch on the side facing the path. Hens (layer
 * "hen"): a white body, head and red comb, facing `a`.
 */
function coopParts(coops: GeoJSON.Feature[], hens: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  const at = (lng: number, lat: number, a: number) => {
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    // a box centred `x` along u and `y` along v, half sizes hx, hy
    return (part: string, x: number, y: number, hx: number, hy: number, base: number, top: number) => out.push({
      type: 'Feature', properties: { part, base, top },
      geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => {
        const px = u[0] * (x + hx * i) + v[0] * (y + hy * j), py = u[1] * (x + hx * i) + v[1] * (y + hy * j);
        return [lng + px / kx, lat + py / ky];
      })] },
    });
  };
  for (const f of coops.filter((x) => x.properties?.kind === 'coop')) {
    const pr = f.properties ?? {};
    const [lng, lat] = pr.centre as number[];
    const box = at(lng, lat, Number(pr.a) || 0);
    const L = (Number(pr.long) || 6) / 2, W = (Number(pr.wide) || 2.5) / 2;
    for (const [x, y] of [[-L + 0.2, -W + 0.2], [L - 0.2, -W + 0.2], [-L + 0.2, W - 0.2], [L - 0.2, W - 0.2]]) box('coopwall', x, y, 0.08, 0.08, 0, 0.35); // legs
    box('coopwall', 0, 0, L, W, 0.35, 1.6); // walls
    // roof: the ridge runs along the coop; five slabs narrowing upwards, eaves 0.25 m out
    for (let k = 0; k < 5; k++) box('cooproof', 0, 0, L + 0.25, (W + 0.3) * (1 - k / 5), 1.6 + k * 0.17, 1.6 + (k + 1) * 0.17);
    // a ramp from the ground up to a hatch on one long side (+v), in three steps
    for (let k = 0; k < 3; k++) box('ramp', 0, W + 0.25 + (2 - k) * 0.35, 0.3, 0.18, 0, 0.12 + k * 0.12);
    box('cooproof', 0, W + 0.01, 0.28, 0.02, 0.45, 0.9); // hatch
  }
  for (const f of hens) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const box = at(lng, lat, Number(f.properties?.a) || 0);
    // a little larger than life (0.4 m long), so they read on the map
    box('hen', 0, 0, 0.22, 0.14, 0.1, 0.38); // body
    box('hen', 0.22, 0, 0.08, 0.08, 0.32, 0.48); // head
    box('comb', 0.22, 0, 0.045, 0.035, 0.48, 0.55);
  }
  return out;
}

/**
 * Football goals (layer "goal"): two posts and a crossbar `w` x `h` metres, square to the pitch's
 * long axis `a`, with the net's frame running back a little behind them.
 */
function goalParts(points: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = [];
  for (const f of points) {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const a = Number(f.properties?.a) || 0, w = Number(f.properties?.w) || 7.32, h = Number(f.properties?.h) || 2.44;
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
    const u = [Math.cos(a), Math.sin(a)], v = [u[1], -u[0]];
    const box = (x: number, y: number, hx: number, hy: number, base: number, top: number) => out.push({
      type: 'Feature', properties: { part: 'goal', base, top },
      geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([i, j]) => {
        const px = v[0] * (x + hx * i) + u[0] * (y + hy * j), py = v[1] * (x + hx * i) + u[1] * (y + hy * j);
        return [lng + px / kx, lat + py / ky];
      })] },
    });
    // which way is behind the goal: away from the pitch centre, i.e. along -u at the south end and +u at the north
    const back = Math.sign(Number(f.properties?.back) || 0) || 1;
    for (const x of [-w / 2, w / 2]) {
      box(x, 0, 0.07, 0.07, 0, h); // post
      box(x, back * 0.9, 0.04, 0.9, 0, 0.08); // ground bar of the net frame
    }
    box(0, 0, w / 2 + 0.07, 0.07, h - 0.12, h); // crossbar
  }
  return out;
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
    const nBlocks = Math.max(1, Math.round(L / WALL.block));
    for (let k = 0; k < nBlocks; k++) {
      const d0 = (L * k) / nBlocks, d1 = (L * (k + 1)) / nBlocks, mid = pointAt((d0 + d1) / 2, 0);
      put(band(d0, d1, WALL.half), 'stone', WALL.plinth, WALL.plinth + WALL.course, { tone: tone(mid[0] + lng0 * 1e4, mid[1]) });
    }
    // plinth and coping in runs of a few blocks: one band along a whole winding piece (Whitelands'
    // wall, nearly a closed ring with sharp corners) crossed itself and filled a wedge of ground
    const RUN = 4;
    for (let k = 0; k < nBlocks; k += RUN) {
      const d0 = (L * k) / nBlocks, d1 = (L * Math.min(nBlocks, k + RUN)) / nBlocks;
      put(band(d0, d1, WALL.plinthHalf), 'plinth', 0, WALL.plinth);
      put(band(d0, d1, WALL.copeHalf), 'cope', WALL.plinth + WALL.course, WALL.cope);
    }
  }
  return { type: 'FeatureCollection', features: out };
}

/** metres the camera's centre may go past the island's edge (Southlands to Whitelands) */
const ISLAND_PAD_M = 120;
/**
 * Keeps the camera's centre over the island: inside its outline, or at most ISLAND_PAD_M past it
 * (room for a place on the edge to sit above its card). Measured from
 * the outline itself, not its box, since the island runs diagonally and a box's corners are empty.
 * It holds the centre, not the screen's edges, so it works the same turned and tilted and never
 * forces a zoom.
 */
function islandConstrain(zonePolys: GeoJSON.Position[][][] | null, bounds: [number, number, number, number]) {
  const mx = (lng: number) => (lng + 180) / 360;
  const my = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
  const [w, s, e, n] = bounds;
  const rings = (zonePolys ? zonePolys.map((p) => p[0]) : [[[w, s], [e, s], [e, n], [w, n], [w, s]]])
    .map((r) => r.map(([lng, lat]) => [mx(lng), my(lat)] as [number, number]));
  const lat0 = (s + n) / 2;
  const padM = ISLAND_PAD_M / (40075017 * Math.cos((lat0 * Math.PI) / 180)); // metres as a share of the world's width
  const inside = (x: number, y: number) => rings.some((r) => {
    let k = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) k = !k;
    }
    return k;
  });
  const nearest = (x: number, y: number) => {
    let best = Infinity, bx = x, by = y;
    for (const r of rings) for (let i = 1; i < r.length; i++) {
      const [ax, ay] = r[i - 1], [cx, cy] = r[i], dx = cx - ax, dy = cy - ay, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
      const px = ax + t * dx, py = ay + t * dy, d = (x - px) ** 2 + (y - py) ** 2;
      if (d < best) { best = d; bx = px; by = py; }
    }
    return [bx, by, Math.sqrt(best)];
  };
  return (lngLat: maplibregl.LngLat, zoom: number) => {
    const x = mx(lngLat.lng), y = my(lngLat.lat);
    if (inside(x, y)) return { center: lngLat, zoom };
    const r = padM;
    const [px, py, d] = nearest(x, y);
    if (d <= r) return { center: lngLat, zoom };
    const nx = px + ((x - px) * r) / d, ny = py + ((y - py) * r) / d;
    return { center: new maplibregl.LngLat(nx * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * ny))) * 180) / Math.PI), zoom };
  };
}

export function createMap(opts: {
  container: string | HTMLElement;
  campus: GeoJSON.FeatureCollection;
  walls?: GeoJSON.FeatureCollection;
  bounds: [number, number, number, number];
  theme: Theme;
  interactive?: boolean;
  /** bus stops: a shelter and a stop pole on the pavement at each (stopFrames) */
  stops?: StopFrame[];
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
  buildings.features = buildings.features.map((f) => ({ ...f, properties: { ...f.properties, roof: ROOFS[f.properties?.osmId] ?? f.properties?.roof ?? 'flat' } }));
  const [w, s, e, n] = bounds;
  // a big frame around campus, so the edge of the world reads as "off the map". Its hole is the map's
  // own edge (layer "mapedge", from build-campus.mjs: campus plus the strip of golf course beside it),
  // or the bounds when there is none.
  // With the context zone (layer "contextzone", scripts/build-context.mjs: campus, Chadwick Hall, the
  // hospital and a corridor along the two main roads) the frame is solid and plain, its edge faded
  // (layer "zone-fade"), and the zone is its hole.
  const pad = 0.02;
  const frame = [[w - pad, s - pad], [e + pad, s - pad], [e + pad, n + pad], [w - pad, n + pad], [w - pad, s - pad]];
  const zone = campus.features.find((f) => f.properties?.layer === 'contextzone' && f.geometry.type === 'MultiPolygon');
  const edge = campus.features.find((f) => f.properties?.layer === 'mapedge' && f.geometry.type === 'Polygon');
  const zonePolys = zone ? (zone.geometry as GeoJSON.MultiPolygon).coordinates : null;
  const outside: GeoJSON.Feature = {
    type: 'Feature', properties: {},
    geometry: zonePolys
      ? { type: 'MultiPolygon', coordinates: [[frame, ...zonePolys.map((p) => [...p[0]].reverse())], ...zonePolys.flatMap((p) => p.slice(1).map((h) => [[...h].reverse()]))] }
      : { type: 'Polygon', coordinates: [frame, edge ? [...(edge.geometry as GeoJSON.Polygon).coordinates[0]].reverse() : [[w, s], [w, n], [e, n], [e, s], [w, s]]] },
  };
  const zoneLines: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: (zonePolys ?? []).flat().map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } })) };

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
      props: { type: 'geojson', data: { type: 'FeatureCollection', features: [...carParts(byLayer('car').features).features, ...fountainParts(byLayer('fountain').features).features, ...fences.posts, ...gardenParts(byLayer('statue').features, byLayer('flowerbed').features), ...goalParts(byLayer('goal').features), ...benchParts(byLayer('bench').features), ...coopParts(byLayer('monument').features, byLayer('hen').features), ...picnicParts(byLayer('picnic').features), ...busStopParts(opts.stops ?? [])] }, tolerance: 0 }, // tiny parts: never simplified away at low zoom
      fence: { type: 'geojson', data: fences.mesh, tolerance: 0 },
      monument: { type: 'geojson', data: monumentParts(byLayer('monument').features) },
      flags: { type: 'geojson', data: { type: 'FeatureCollection', features: flagParts(byLayer('golfflag').features) }, tolerance: 0 },
      outside: { type: 'geojson', data: outside },
      zoneedge: { type: 'geojson', data: zoneLines },
      user: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      hop: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'background', type: 'background', paint: {} },
      { id: 'campus-ground', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'campusground'], paint: { 'fill-antialias': true } },
      { id: 'lot', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'lot'], paint: {} },
      { id: 'green', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'green'], paint: {} },
      // the golf course west of campus: rough, fairways, tees, greens and bunkers, flat on the grass
      { id: 'golf', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'golf'], paint: { 'fill-antialias': true } },
      { id: 'pitch', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'pitch'], paint: {} },
      { id: 'parking', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'parking'], paint: {} },
      // tennis court markings on the MUGA (about 5 cm lines, so they only show up close)
      {
        id: 'courtline', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'courtline'], minzoom: DETAIL_ZOOM,
        paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14.5, 0.35, 16.5, 0.6, 19.5, 3] },
      },
      { id: 'water', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'water'], paint: {} },
      { id: 'shore', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'water'], paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 5], 'line-blur': 1 } },
      { id: 'waterway', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'waterway'], paint: { 'line-width': 3 } },
      {
        id: 'road-edge', type: 'line', source: 'campus',
        filter: ['==', ['get', 'layer'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // footpaths fade in as you zoom in (the roads and the wall's line stay)
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 15.2, ['match', ['get', 'kind'], 'footpath', 0.4, 1], 16.2, 1],
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15,
            ['match', ['get', 'kind'], 'footpath', 3, 'service', 3.5, 'wall', 3.6, 4.5], 19,
            ['match', ['get', 'kind'], 'footpath', 15, 'service', 21, 'wall', 8, 30]],
        },
      },
      {
        id: 'road', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // footpaths fade in as you zoom in (the roads and the wall's line stay)
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 15.2, ['match', ['get', 'kind'], 'footpath', 0.4, 1], 16.2, 1],
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15,
            ['match', ['get', 'kind'], 'footpath', 1.7, 'service', 2, 'wall', 2.2, 3], 19,
            ['match', ['get', 'kind'], 'footpath', 12, 'service', 18, 'wall', 6, 26]],
        },
      },
      { id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-opacity': zonePolys ? 1 : 0.85 } },
      // the zone's edge: a wide blurred line in the frame's colour, so the map fades out instead of stopping at a line
      {
        id: 'zone-fade', type: 'line', source: 'zoneedge', layout: { 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 10, 16, 36, 19, 200],
          'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 14, 10, 16, 36, 19, 200],
        },
      },
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
        // windows from the first frame (the images come from the missing-image resolver below)
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true, 'fill-extrusion-pattern': windowPattern(false) },
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
      // solar panels: rows of real panels standing on the roof (solarRows) close up, one block from afar
      {
        id: 'roof-solar-far', type: 'fill-extrusion', source: 'roofparts', maxzoom: SOLAR_ROWS_ZOOM,
        filter: SOLAR_FAR_FILTER,
        paint: {
          'fill-extrusion-height': ['+', ['get', 'h'], ['get', 'top'], BOUNCE],
          'fill-extrusion-base': ['+', ['get', 'h'], ['get', 'base'], BOUNCE],
          'fill-extrusion-vertical-gradient': false,
        },
      },
      {
        id: 'roof-solar', type: 'fill-extrusion', source: 'roofparts', minzoom: SOLAR_ROWS_ZOOM,
        filter: SOLAR_FILTER,
        paint: {
          'fill-extrusion-height': ['+', ['get', 'h'], ['get', 'top'], BOUNCE],
          'fill-extrusion-base': ['+', ['get', 'h'], ['get', 'base'], BOUNCE],
          'fill-extrusion-vertical-gradient': false,
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
        id: 'props', type: 'fill-extrusion', source: 'props', minzoom: DETAIL_ZOOM,
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'] },
      },
      // historic stone monuments: shown from afar like the buildings, but never tappable as one
      {
        id: 'monument', type: 'fill-extrusion', source: 'monument',
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-vertical-gradient': true },
      },
      // golf flags, one size per zoom band (FLAG_SIZES)
      ...FLAG_SIZES.map(({ k, from, to }): LayerSpecification => ({
        id: `golfflag-${k}`, type: 'fill-extrusion', source: 'flags', filter: ['==', ['get', 'k'], k],
        minzoom: Math.max(from, DETAIL_ZOOM), maxzoom: to,
        paint: { 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-vertical-gradient': false },
      })),
      // wire mesh: see-through, so it goes in its own layer with a layer-wide opacity
      {
        id: 'fence-mesh', type: 'fill-extrusion', source: 'fence', minzoom: DETAIL_ZOOM,
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
    // How far the camera may go: its centre stays over the map's island (Southlands to Whitelands)
    // or within ISLAND_PAD_M of it (islandConstrain), in place of a maxBounds box, which would
    // force a zoom-in on wide screens and leave the island's empty corners reachable.
    transformConstrain: islandConstrain(zonePolys, [w, s, e, n]),
    pitch: 55,
    maxPitch: 65,
    minZoom: 13.5, // a full step below the opening view on a phone (about 14.9), so − always works there; the whole island fits at about 14.3
    maxZoom: 19.5,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: false,
    interactive: opts.interactive ?? true,
    fadeDuration: 0,
    pixelRatio: Math.min(devicePixelRatio || 1, 2), // sharp enough, cheaper on 3x phones
  });
  // two fingers: pinch to zoom, twist to turn, slide up or down together to tilt
  currentTheme = theme;
  setCssVars(theme);
  // pattern images are drawn on demand, so the first frame never asks for a missing one
  map.setMissingStyleImageResolver((id) => {
    if (WINDOW_IMAGES.includes(id)) setWindowImages(map, PALETTE[currentTheme]);
  });
  windowsNear = false;
  map.once('load', () => {
    setWindowImages(map, PALETTE[currentTheme]);
    updateWindows(map);
    map.on('zoomend', () => updateWindows(map));
  });
  return map;
}

type PaintArgs = Parameters<MLMap['setPaintProperty']>;
let currentTheme: Theme = 'light';
const setCssVars = (theme: Theme) => { for (const [k, v] of Object.entries(cssVars(theme))) document.documentElement.style.setProperty(k, v); };
export function applyTheme(map: MLMap, theme: Theme) {
  currentTheme = theme;
  setCssVars(theme);
  // (map.loaded() reads false while the route dashes animate, so check for the images instead)
  if (map.hasImage('win')) setWindowImages(map, PALETTE[theme]);
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

/**
 * Runs a change to the map's style now, or, if the style hasn't finished loading (a place chosen
 * from the search in the first seconds on a slow phone), once the map has loaded.
 */
function whenLoaded(map: MLMap, change: () => void) {
  try { change(); } catch (e) {
    if (!/not done loading/i.test(String((e as Error)?.message))) throw e;
    map.once('load', change);
  }
}

let selectedId: string | null = null;
export function selectBuilding(map: MLMap, osmId: string | null) {
  whenLoaded(map, () => selectBuildingNow(map, osmId));
}
function selectBuildingNow(map: MLMap, osmId: string | null) {
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
  whenLoaded(map, () => setXrayNow(map, ids));
}
function setXrayNow(map: MLMap, ids: string[]) {
  // a split block is one building on the map: see through all of it
  const blocks = new Set(halves.filter((h) => ids.includes(h.id)).map((h) => h.block));
  const sorted = [...new Set([...ids, ...halves.filter((h) => blocks.has(h.block)).map((h) => h.id)])].sort();
  const key = sorted.join(',');
  if (key === xray || !map.getLayer('building-ghost')) return;
  const out: Expr = ['!', inIds(sorted)];
  const any = sorted.length > 0;
  map.setFilter('building-walls', any ? out : null);
  map.setFilter('building-roof', any ? out : null);
  map.setFilter('building-top', any ? ['all', TOP_FILTER, out] : TOP_FILTER);
  map.setFilter('roof-solar', any ? ['all', SOLAR_FILTER, out] : SOLAR_FILTER);
  map.setFilter('roof-solar-far', any ? ['all', SOLAR_FAR_FILTER, out] : SOLAR_FAR_FILTER);
  map.setFilter('building-ghost', inIds(sorted));
  // only once every filter took: a retry after the map loads must not think it's already done
  xray = key;
}

export function setGeoJSON(map: MLMap, source: 'user' | 'route' | 'hop', data: GeoJSON.Feature | GeoJSON.FeatureCollection) {
  (map.getSource(source) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

export const lineFeature = (coords: LngLat[]): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

/** Trees standing on or right beside a route are hidden while it shows, so the line stays readable. */
export function clearTreesAlong(map: MLMap, line: LngLat[] | null, metres = 7) {
  whenLoaded(map, () => clearTreesAlongNow(map, line, metres));
}
function clearTreesAlongNow(map: MLMap, line: LngLat[] | null, metres: number) {
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
