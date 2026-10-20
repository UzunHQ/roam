import maplibregl, { type ExpressionSpecification as Expr, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import type { LngLat } from './types';

export type Theme = 'light' | 'dark';

// College colours follow the official campus map: Digby Stuart light blue, Froebel yellow, Southlands navy.
const PALETTE = {
  light: {
    bg: '#cfe9b8', green: '#b6df98', wood: '#a3d487', pitch: '#9fd889', pitchLine: '#e9f7dd',
    water: '#9fd8f2', road: '#fbf3e4', roadEdge: '#e4d6bb', footpath: '#fffaf0', service: '#f6eedd',
    digby: '#a8d8f5', digbyRoof: '#6aaed8', froebel: '#ffe08a', froebelRoof: '#e6b43c',
    southlands: '#5c74b8', southlandsRoof: '#2d3f78', other: '#eae3d6', otherRoof: '#c9bca6',
    selected: '#ff9fb2', trunk: '#a87a55', leaf: '#7cc56a', leafDark: '#5aa84f', accuracy: '#4b8df8',
    route: '#ff6b8b', outside: '#bcd9a6',
  },
  dark: {
    bg: '#22303a', green: '#2b4237', wood: '#2f4a3a', pitch: '#2e4a37', pitchLine: '#46664f',
    water: '#28506a', road: '#3a4652', roadEdge: '#2a333c', footpath: '#4a5866', service: '#36424d',
    digby: '#5a90b8', digbyRoof: '#3c6a8e', froebel: '#c9a64a', froebelRoof: '#8f7228',
    southlands: '#4b5f9e', southlandsRoof: '#2c3a6a', other: '#4a525c', otherRoof: '#363d45',
    selected: '#ff8aa3', trunk: '#6e5340', leaf: '#3f7a4c', leafDark: '#2f6140', accuracy: '#6ea6ff',
    route: '#ff7f9c', outside: '#1c2830',
  },
} as const;

type Pal = (typeof PALETTE)[Theme];

const collegeColor = (p: Pal, roof: boolean): Expr => [
  'match', ['get', 'college'],
  'digby-stuart', roof ? p.digbyRoof : p.digby,
  'froebel', roof ? p.froebelRoof : p.froebel,
  'southlands', roof ? p.southlandsRoof : p.southlands,
  roof ? p.otherRoof : p.other,
];

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
    waterway: { 'line-color': p.water },
    'road-edge': { 'line-color': p.roadEdge },
    road: { 'line-color': ['match', ['get', 'kind'], 'footpath', p.footpath, 'service', p.service, p.road] },
    'building-walls': {
      'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'selected'], false], p.selected, collegeColor(p, false)],
    },
    'building-roof': {
      'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'selected'], false], p.selected, collegeColor(p, true)],
    },
    'tree-trunk': { 'fill-extrusion-color': p.trunk },
    'tree-leaf': { 'fill-extrusion-color': ['case', ['==', ['get', 'tier'], 0], p.leafDark, p.leaf] },
    accuracy: { 'fill-color': p.accuracy },
    'accuracy-line': { 'line-color': p.accuracy },
    route: { 'line-color': p.route },
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
    },
    layers: [
      { id: 'background', type: 'background', paint: {} },
      { id: 'green', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'green'], paint: {} },
      { id: 'pitch', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'pitch'], paint: {} },
      { id: 'water', type: 'fill', source: 'campus', filter: ['==', ['get', 'layer'], 'water'], paint: {} },
      { id: 'waterway', type: 'line', source: 'campus', filter: ['==', ['get', 'layer'], 'waterway'], paint: { 'line-width': 3 } },
      {
        id: 'road-edge', type: 'line', source: 'campus',
        filter: ['all', ['==', ['get', 'layer'], 'path'], ['!=', ['get', 'kind'], 'footpath']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 4, 19, 30] },
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
      { id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 6, 'line-dasharray': [0.1, 2] } },
      { id: 'accuracy', type: 'fill', source: 'user', paint: { 'fill-opacity': 0.14 } },
      { id: 'accuracy-line', type: 'line', source: 'user', paint: { 'line-width': 1.5, 'line-opacity': 0.5 } },
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
    light: { anchor: 'map', position: [1.3, 210, 40], intensity: 0.35, color: '#ffffff' },
  };
  // fill in theme colours before the first render
  const paints = themedPaint(PALETTE[theme]);
  for (const layer of style.layers) Object.assign((layer as { paint: Record<string, unknown> }).paint ??= {}, paints[layer.id] ?? {});

  const map = new maplibregl.Map({
    container: opts.container,
    style,
    bounds: [w, s, e, n],
    fitBoundsOptions: { padding: 10 },
    maxBounds: [w, s, e, n],
    pitch: 55,
    maxPitch: 65,
    minZoom: 15,
    maxZoom: 19.5,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: false,
    interactive: opts.interactive ?? true,
    fadeDuration: 0,
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

export function setGeoJSON(map: MLMap, source: 'user' | 'route', data: GeoJSON.Feature | GeoJSON.FeatureCollection) {
  (map.getSource(source) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

export const lineFeature = (coords: LngLat[]): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
