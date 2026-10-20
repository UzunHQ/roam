import maplibregl, { type ExpressionSpecification as Expr, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import type { LngLat } from './types';
import { ROOFS, isPitched } from './roofs';

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
    green: { 'fill-color': ['case', ['get', 'wooded'], p.wood, p.green] },
    pitch: { 'fill-color': p.pitch, 'fill-outline-color': p.pitchLine },
    water: { 'fill-color': p.water },
    shore: { 'line-color': p.shore },
    waterway: { 'line-color': p.water },
    'road-edge': { 'line-color': ['match', ['get', 'kind'], 'footpath', p.footpathEdge, p.roadEdge] },
    road: { 'line-color': ['match', ['get', 'kind'], 'footpath', p.footpath, p.road] },
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
    'building-halo': { 'line-color': p.selected },
  };
}

let treeCenters: LngLat[] = [];

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
  map.setPaintProperty('building-walls', 'fill-extrusion-pattern', want ? ['case', ['coalesce', ['get', 'campus'], true], 'win', 'win-off'] : null);
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

export function createMap(opts: {
  container: string | HTMLElement;
  campus: GeoJSON.FeatureCollection;
  bounds: [number, number, number, number];
  theme: Theme;
  interactive?: boolean;
}): MLMap {
  const { campus, bounds, theme } = opts;
  const byLayer = (l: string) => ({ type: 'FeatureCollection', features: campus.features.filter((f) => f.properties?.layer === l) }) as GeoJSON.FeatureCollection;
  // each building carries its roof type (src/roofs.ts) so the layers can style by it
  const buildings = byLayer('building');
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
      campus: { type: 'geojson', data: campus, promoteId: 'osmId' },
      buildings: { type: 'geojson', data: buildings, promoteId: 'osmId' },
      roofparts: { type: 'geojson', data: roofParts(buildings), promoteId: 'osmId' },
      trees: { type: 'geojson', data: treePolygons(byLayer('tree').features) },
      outside: { type: 'geojson', data: outside },
      user: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      hop: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'background', type: 'background', paint: {} },
      { id: 'green', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'green'], paint: {} },
      { id: 'pitch', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'pitch'], paint: {} },
      { id: 'water', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'water'], paint: {} },
      { id: 'shore', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'water'], paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 19, 5], 'line-blur': 1 } },
      { id: 'waterway', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'waterway'], paint: { 'line-width': 3 } },
      {
        id: 'road-edge', type: 'line', source: 'campus',
        filter: ['==', ['get', 'layer'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15,
            ['match', ['get', 'kind'], 'footpath', 3, 'service', 3.5, 4.5], 19,
            ['match', ['get', 'kind'], 'footpath', 15, 'service', 21, 30]],
        },
      },
      {
        id: 'road', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15,
            ['match', ['get', 'kind'], 'footpath', 1.7, 'service', 2, 3], 19,
            ['match', ['get', 'kind'], 'footpath', 12, 'service', 18, 26]],
        },
      },
      { id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-opacity': 0.85 } },
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
      // buildings standing between you and the route turn see-through while it shows (setXray)
      {
        id: 'building-ghost', type: 'fill-extrusion', source: 'buildings', filter: inIds([]),
        paint: { 'fill-extrusion-height': RIM, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.42, 'fill-extrusion-vertical-gradient': false },
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
    minZoom: 15,
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
  map.on('styleimagemissing', (e: { id: string }) => {
    if (e.id === 'solar-cells' || e.id === 'win' || e.id === 'win-off') setWindowImages(map, PALETTE[currentTheme]);
  });
  map.once('load', () => {
    setWindowImages(map, PALETTE[currentTheme]);
    updateWindows(map);
    map.on('zoomend', () => updateWindows(map));
  });
  return map;
}

let currentTheme: Theme = 'light';
export function applyTheme(map: MLMap, theme: Theme) {
  currentTheme = theme;
  if (map.loaded()) setWindowImages(map, PALETTE[theme]);
  const paints = themedPaint(PALETTE[theme]);
  for (const [layer, props] of Object.entries(paints)) {
    if (!map.getLayer(layer)) continue;
    for (const [k, v] of Object.entries(props)) map.setPaintProperty(layer, k, v);
  }
}

/** A short, non-blocking hop of one building (feature-state animated over ~450 ms). */
export function bounceBuilding(map: MLMap, osmId: string) {
  const start = performance.now();
  const tick = (t: number) => {
    const k = Math.min(1, (t - start) / 450);
    const v = Math.sin(k * Math.PI) * (1 - k * 0.4);
    for (const source of ['buildings', 'roofparts']) map.setFeatureState({ source, id: osmId }, { bounce: k < 1 ? v : 0 });
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let selectedId: string | null = null;
export function selectBuilding(map: MLMap, osmId: string | null) {
  if (selectedId) for (const source of ['buildings', 'roofparts']) map.setFeatureState({ source, id: selectedId }, { selected: false });
  selectedId = osmId;
  if (osmId) for (const source of ['buildings', 'roofparts']) map.setFeatureState({ source, id: osmId }, { selected: true });
}

/**
 * See-through mode: the given buildings leave the solid layers and are drawn as one pale,
 * glassy block instead, so a route behind them stays visible. An empty list puts everything back.
 */
let xray = '';
export function setXray(map: MLMap, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
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
