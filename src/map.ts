import maplibregl, { type ExpressionSpecification as Expr, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import type { LngLat } from './types';

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
    selected: '#ff7a59', selectedWall: '#ffe2d8', trunk: '#a27b5b', leaf: '#8fcb7d', leafDark: '#6fb465', accuracy: '#3b82f6',
    route: '#ff4f7b', routeCase: '#ffffff', routeFlow: '#ffffff', outside: '#c2d8b1', shadow: 'rgba(52,70,40,0.14)',
  },
  dark: {
    bg: '#1f2e28', green: '#27402f', wood: '#2b4a37', pitch: '#2a4934', pitchLine: '#46664f',
    water: '#2a6466', shore: '#3f8384', road: '#4a5157', roadEdge: '#2c3237', footpath: '#6d6450', footpathEdge: '#4d4636',
    wall: '#5a6168', wallOff: '#3d434a',
    digbyRoof: '#5689b0', froebelRoof: '#b39545', southlandsRoof: '#7666a8', otherRoof: '#7a6a5a', offRoof: '#454a52',
    digbyRim: '#456f90', froebelRim: '#917834', southlandsRim: '#5e5188', otherRim: '#625548', offRim: '#3a3f46',
    glass: '#e9d8a0', frame: '#4b5157', glassOff: '#8a8466',
    selected: '#ff8a6b', selectedWall: '#8a5d52', trunk: '#6e5340', leaf: '#3f7a4c', leafDark: '#2f6140', accuracy: '#6ea6ff',
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
const wallColor = (p: Pal): Expr => ['case', ['coalesce', ['get', 'campus'], true], p.wall, p.wallOff];
const SELECTED: Expr = ['boolean', ['feature-state', 'selected'], false];

// chunky: unknown heights become 2-3 storeys; known ones are kept
const HEIGHT: Expr = ['coalesce', ['get', 'height'], ['match', ['get', 'building'], ['house', 'detached', 'shed', 'garage'], 6, 9]];
const BOUNCE: Expr = ['*', ['coalesce', ['feature-state', 'bounce'], 0], 5];
const ROOF = 1.2; // parapet: full footprint, a darker rim colour
const TOP = 0.45; // the roof panel, inset ~1 m, stands a little proud of the parapet (from zoom 16.3)

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
    'building-top': { 'fill-extrusion-color': ['case', SELECTED, p.selected, roofColor(p)] },
    'tree-trunk': { 'fill-extrusion-color': p.trunk },
    'tree-leaf': { 'fill-extrusion-color': ['case', ['==', ['get', 'tier'], 0], p.leafDark, p.leaf] },
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
 * Shrinks a building outline by `m` metres (mitred offset, works for L- and U-shapes), for the
 * raised roof panel. Footprints that are too small to inset are left out.
 */
function insetAll(fc: GeoJSON.FeatureCollection, m: number): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const f of fc.features) {
    if (f.geometry.type !== 'Polygon') continue;
    const ring = (f.geometry.coordinates[0] as LngLat[]).slice(0, -1);
    if (ring.length < 3) continue;
    const lat0 = ring[0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 111320;
    const pts = ring.map(([x, y]) => [x * kx, y * ky]);
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; area += x0 * y1 - x1 * y0; }
    if (Math.abs(area / 2) < 60) continue; // sheds and kiosks keep a plain roof
    const sign = area > 0 ? 1 : -1; // counter-clockwise: inward is to the left of each edge
    const unitIn = (a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(-dy / l) * sign, (dx / l) * sign]; };
    const moved = pts.map((p, i) => {
      const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
      const n1 = unitIn(prev, p), n2 = unitIn(p, next);
      const dot = n1[0] * n2[0] + n1[1] * n2[1];
      const k = Math.min(m / Math.max(1 + dot, 0.25), m * 3); // mitre, capped on sharp corners
      return [(p[0] + (n1[0] + n2[0]) * k) / kx, (p[1] + (n1[1] + n2[1]) * k) / ky];
    });
    moved.push(moved[0]);
    out.push({ type: 'Feature', properties: f.properties, geometry: { type: 'Polygon', coordinates: [moved] } });
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
function setWindowImages(map: MLMap, p: Pal) {
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

/** Low-poly trees: a hexagonal trunk and two stacked, shrinking hexagonal canopies. */
function treePolygons(points: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  const hex = ([lng, lat]: number[], r: number, rot: number): GeoJSON.Polygon => {
    const dLat = r / 111320, dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
    const ring = Array.from({ length: 7 }, (_, i) => {
      const a = rot + (i % 6) * (Math.PI / 3);
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
    out.push({ type: 'Feature', properties: { t, part: 'trunk', base: 0, top: 2.2 * s }, geometry: hex(c, 0.45 * s, rot) });
    out.push({ type: 'Feature', properties: { t, part: 'leaf', tier: 0, base: 2 * s, top: 5 * s }, geometry: hex(c, 2.4 * s, rot) });
    out.push({ type: 'Feature', properties: { t, part: 'leaf', tier: 1, base: 5 * s, top: 7.2 * s }, geometry: hex(c, 1.5 * s, rot + 0.5) });
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
      buildings: { type: 'geojson', data: byLayer('building'), promoteId: 'osmId' },
      roofs: { type: 'geojson', data: insetAll(byLayer('building'), 1), promoteId: 'osmId' },
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
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE, ROOF], 'fill-extrusion-base': ['+', HEIGHT, BOUNCE], 'fill-extrusion-opacity': 1 },
      },
      {
        id: 'building-top', type: 'fill-extrusion', source: 'roofs', minzoom: 16.3,
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE, ROOF, TOP], 'fill-extrusion-base': ['+', HEIGHT, BOUNCE, ROOF], 'fill-extrusion-opacity': 1 },
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
  map.once('load', () => {
    setWindowImages(map, PALETTE[theme]);
    updateWindows(map);
    map.on('zoomend', () => updateWindows(map));
  });
  return map;
}

export function applyTheme(map: MLMap, theme: Theme) {
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
    for (const source of ['buildings', 'roofs']) map.setFeatureState({ source, id: osmId }, { bounce: k < 1 ? v : 0 });
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let selectedId: string | null = null;
export function selectBuilding(map: MLMap, osmId: string | null) {
  if (selectedId) for (const source of ['buildings', 'roofs']) map.setFeatureState({ source, id: selectedId }, { selected: false });
  selectedId = osmId;
  if (osmId) for (const source of ['buildings', 'roofs']) map.setFeatureState({ source, id: osmId }, { selected: true });
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
