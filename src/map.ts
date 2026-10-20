import maplibregl, { type ExpressionSpecification as Expr, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import type { LngLat } from './types';

export type Theme = 'light' | 'dark';

// Buildings: warm neutral walls; roofs carry the official college colours
// (Digby Stuart light blue, Froebel yellow, Southlands navy) so zones stay recognisable.
const PALETTE = {
  light: {
    bg: '#c4e6a5', green: '#b2df8f', wood: '#93cf77', pitch: '#a5d985', pitchLine: '#effbe6',
    water: '#7fcbed', shore: '#c4ebf8', road: '#ffffff', roadEdge: '#d8d0c0', footpath: '#f6e3bb', footpathEdge: '#e2c995',
    wall: '#f7eedf', wallOff: '#ebe6dc',
    digbyRoof: '#86c3ea', froebelRoof: '#f4c84f', southlandsRoof: '#3a5598', otherRoof: '#d7c6a8', offRoof: '#d3cdc2',
    selected: '#ff6b6b', selectedWall: '#ffd9d3', trunk: '#a77b56', leaf: '#76c35f', leafDark: '#58a94a', accuracy: '#3b82f6',
    route: '#ff4f7b', routeCase: '#ffffff', outside: '#b3d79a',
  },
  dark: {
    bg: '#203029', green: '#284235', wood: '#2c4a38', pitch: '#2b4a35', pitchLine: '#46664f',
    water: '#285a78', shore: '#3d7595', road: '#4a5560', roadEdge: '#2a333c', footpath: '#6a5f48', footpathEdge: '#4d4535',
    wall: '#59606a', wallOff: '#3d434b',
    digbyRoof: '#4f88b3', froebelRoof: '#b9953a', southlandsRoof: '#3f5594', otherRoof: '#6e6656', offRoof: '#454a52',
    selected: '#ff7b7b', selectedWall: '#8a5a5a', trunk: '#6e5340', leaf: '#3f7a4c', leafDark: '#2f6140', accuracy: '#6ea6ff',
    route: '#ff7f9c', routeCase: '#1b2228', outside: '#1a2722',
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
const wallColor = (p: Pal): Expr => ['case', ['coalesce', ['get', 'campus'], true], p.wall, p.wallOff];
const SELECTED: Expr = ['boolean', ['feature-state', 'selected'], false];

// chunky: unknown heights become 2-3 storeys; known ones are kept
const HEIGHT: Expr = ['coalesce', ['get', 'height'], ['match', ['get', 'building'], ['house', 'detached', 'shed', 'garage'], 6, 9]];
const BOUNCE: Expr = ['*', ['coalesce', ['feature-state', 'bounce'], 0], 5];
const ROOF = 1.2;

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
    'building-roof': { 'fill-extrusion-color': ['case', SELECTED, p.selected, roofColor(p)] },
    'tree-trunk': { 'fill-extrusion-color': p.trunk },
    'tree-leaf': { 'fill-extrusion-color': ['case', ['==', ['get', 'tier'], 0], p.leafDark, p.leaf] },
    accuracy: { 'fill-color': p.accuracy },
    'accuracy-line': { 'line-color': p.accuracy },
    route: { 'line-color': p.route },
    'route-case': { 'line-color': p.routeCase },
    'route-hop': { 'line-color': p.route },
  };
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
  for (const f of points) {
    const c = (f.geometry as GeoJSON.Point).coordinates;
    const s = (f.properties?.s as number) ?? 1;
    const rot = (c[0] * 1e6) % 1;
    out.push({ type: 'Feature', properties: { part: 'trunk', base: 0, top: 2.2 * s }, geometry: hex(c, 0.45 * s, rot) });
    out.push({ type: 'Feature', properties: { part: 'leaf', tier: 0, base: 2 * s, top: 5 * s }, geometry: hex(c, 2.4 * s, rot) });
    out.push({ type: 'Feature', properties: { part: 'leaf', tier: 1, base: 5 * s, top: 7.2 * s }, geometry: hex(c, 1.5 * s, rot + 0.5) });
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
            ['match', ['get', 'kind'], 'footpath', 2.4, 'service', 3.5, 4.5], 19,
            ['match', ['get', 'kind'], 'footpath', 15, 'service', 21, 30]],
        },
      },
      {
        id: 'road', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'path'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15,
            ['match', ['get', 'kind'], 'footpath', 1.2, 'service', 2, 3], 19,
            ['match', ['get', 'kind'], 'footpath', 12, 'service', 18, 26]],
        },
      },
      { id: 'outside', type: 'fill', source: 'outside', paint: { 'fill-opacity': 0.85 } },
      { id: 'route-hop', type: 'line', source: 'hop', layout: { 'line-cap': 'round' }, paint: { 'line-width': 3, 'line-opacity': 0.6, 'line-dasharray': [0.5, 2] } },
      { id: 'route-case', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 13] } },
      { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3.5, 19, 8] } },
      { id: 'accuracy', type: 'fill', source: 'user', paint: { 'fill-opacity': 0.14 } },
      { id: 'accuracy-line', type: 'line', source: 'user', paint: { 'line-width': 1.5, 'line-opacity': 0.5 } },
      { id: 'building-shadow', type: 'fill', source: 'buildings', paint: { 'fill-color': 'rgba(40,50,30,0.16)', 'fill-translate': [4, 4], 'fill-antialias': false } },
      {
        id: 'building-walls', type: 'fill-extrusion', source: 'buildings',
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true },
      },
      {
        id: 'building-roof', type: 'fill-extrusion', source: 'buildings',
        paint: { 'fill-extrusion-height': ['+', HEIGHT, BOUNCE, ROOF], 'fill-extrusion-base': ['+', HEIGHT, BOUNCE], 'fill-extrusion-opacity': 1 },
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
  return map;
}

export function applyTheme(map: MLMap, theme: Theme) {
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
    map.setFeatureState({ source: 'buildings', id: osmId }, { bounce: k < 1 ? v : 0 });
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let selectedId: string | null = null;
export function selectBuilding(map: MLMap, osmId: string | null) {
  if (selectedId) map.setFeatureState({ source: 'buildings', id: selectedId }, { selected: false });
  selectedId = osmId;
  if (osmId) map.setFeatureState({ source: 'buildings', id: osmId }, { selected: true });
}

export function setGeoJSON(map: MLMap, source: 'user' | 'route' | 'hop', data: GeoJSON.Feature | GeoJSON.FeatureCollection) {
  (map.getSource(source) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

export const lineFeature = (coords: LngLat[]): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
