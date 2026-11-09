/**
 * Every map colour, light and dark, in one place: src/map.ts reads its layers' paint from here and
 * the UI's college swatches (the key, the area labels) are set from it too (`cssVars`).
 *
 * Three levels, like a city map's "focus and surroundings":
 * 1. Focus (the university: Southlands, Digby Stuart, Froebel, Whitelands and Chadwick Hall's plot):
 *    green ground, bright trees, a pastel roof colour per college, cream footpaths, the stone wall.
 * 2. Key surroundings (Queen Mary's Hospital, bus stops, shops, the hospital's car park): neutral
 *    ground, but a clear building (off-white with a red edge) and clear pins.
 * 3. Background surroundings (every other building, plot, road and tree): warm grey ground, plain
 *    buildings with almost no windows, white roads, pale sage trees.
 * Colour is never the only cue: the focus also has its wall, its own paths and bold area names.
 */
import type { Theme } from '../map';

/** mix two #rrggbb colours: `t` of `a`, the rest `b` (a see-through colour over a known ground) */
export function blend(a: string, b: string, t: number): string {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return '#' + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}
/** a colour `k` darker (0.1 = 10%) */
const darken = (h: string, k: number) => blend('#000000', h, k);

// the surroundings' tokens
const CTX = {
  light: {
    ground: '#eceae4', outside: '#f3f1ec', wall: '#dad5cc', roof: '#cfc9bf', rim: '#c3bcb1', glass: '#d3cec5',
    road: '#ffffff', roadEdge: '#d8d4cc', footpath: '#f7f5f1', footpathEdge: '#dedad2',
    tree: '#a8b8a0', treeOpacity: 0.7, trunk: '#b9ad9c', water: '#c9dce3', green: '#e3e5dc', lot: '#e7e4dd', lotEdge: '#d8d4cc', parking: '#dfdcd5',
    golf: { rough: '#e2e4da', fairway: '#dbe0d2', tee: '#dde2d4', green: '#d6dccd', bunker: '#ebe5d6', water: '#c9dce3' },
  },
  dark: {
    ground: '#24272b', outside: '#1c1e21', wall: '#33373d', roof: '#2e3237', rim: '#2a2d32', glass: '#3a3f45',
    road: '#3a3f45', roadEdge: '#2b2f34', footpath: '#343940', footpathEdge: '#2c3035',
    tree: '#3f4b42', treeOpacity: 0.7, trunk: '#3b3a37', water: '#2f3d44', green: '#2a2e2f', lot: '#282b2f', lotEdge: '#30343a', parking: '#30343a',
    golf: { rough: '#2a2e2f', fairway: '#2d3331', tee: '#2e3432', green: '#303733', bunker: '#3a3832', water: '#2f3d44' },
  },
};

// the colleges' roof colours (the UI's swatches too); dark mode keeps them, about 10% darker
const ROOFS = {
  digby: '#a8cdee', froebel: '#f6d77a', southlands: '#bba9e8', whitelands: '#f4b48f', other: '#ecd3bb',
  digbyRim: '#86b3dc', froebelRim: '#e2bd55', southlandsRim: '#9f8ad6', whitelandsRim: '#e0935f', otherRim: '#d6b799',
};
const DARK_ROOFS = Object.fromEntries(Object.entries(ROOFS).map(([k, v]) => [k, darken(v, 0.1)])) as typeof ROOFS;

const light = {
  // the focus: campus ground, trees, paths
  bg: CTX.light.ground, ground: '#cfe3be', green: '#c1dcab', wood: '#a6cd8f', pitch: '#b6d99b', pitchLine: '#eef8e4',
  water: '#86d4cf', shore: '#c6efea', road: '#d4d8d8', roadEdge: '#b9bfbf', footpath: '#fcf3dc', footpathEdge: '#d8c08b',
  wall: '#fcf6ea', wallOff: CTX.light.wall,
  digbyRoof: ROOFS.digby, froebelRoof: ROOFS.froebel, southlandsRoof: ROOFS.southlands, whitelandsRoof: ROOFS.whitelands, otherRoof: ROOFS.other, offRoof: CTX.light.roof,
  digbyRim: ROOFS.digbyRim, froebelRim: ROOFS.froebelRim, southlandsRim: ROOFS.southlandsRim, whitelandsRim: ROOFS.whitelandsRim, otherRim: ROOFS.otherRim, offRim: CTX.light.rim,
  glass: '#b9d3e6', frame: '#e6dccb', glassOff: CTX.light.glass, frameOff: CTX.light.wall,
  // key surroundings: the hospital
  hospWall: '#f5f2ee', hospGlass: '#a9cbe4', hospRoof: '#efebe6', hospRim: '#d64541',
  slate1: '#7d8896', slate2: '#919cab', slate3: '#a8b2c0', tile1: '#c7876a', tile2: '#d49a7c', tile3: '#e0ad91',
  greenRoof: '#9fcb7c', solar: '#6a86a8', metal: '#bfcdd8',
  selected: '#ff7a59', selectedWall: '#ffe2d8', trunk: '#a27b5b', leaf: '#8fcb7d', leafDark: '#6fb465', accuracy: '#3b82f6',
  tones: ['#7fc36d', '#6aae5f', '#94cf7c', '#5f9f58', '#a9d47f'], blossom: '#f4b8c8',
  route: '#ff4f7b', routeCase: '#ffffff', routeFlow: '#ffffff', outside: CTX.light.outside, shadow: 'rgba(52,70,40,0.14)',
  stones: ['#b5835b', '#a77852', '#c0906a'], pier: '#bc8b62', plinth: '#7a583e', coping: '#e0c8a2', iron: '#1f3a30', lamp: '#ffe39a',
  cars: ['#f3f1ec', '#c3c9cf', '#5d6670', '#c7675a', '#6b8fb5', '#d9c58f'], carGlass: '#62788c', basin: '#e4dccb', jet: '#d6f3f1',
  fencePost: '#3d5a49', fenceMesh: '#4a6656',
  golf: { rough: '#9cc585', fairway: '#b8dc9b', tee: '#c2e3a6', green: '#cdeab3', bunker: '#ecdcae', water: '#86d4cf' }, stone: '#cfcbc2', stoneDark: '#a8a49b', stoneRoof: '#9ea2a6', flag: '#e5484d', benchWood: '#b98559', busGlass: '#bcd6de', busRoof: '#4d5b64', busPole: '#68767e', busFlag: '#dc3b34', coopWood: '#9a6b45', coopRoof: '#b5523b', hen: '#fbfaf4', comb: '#e0412e', goalPost: '#ffffff', plinthStone: '#d9cfbd', bronze: '#7d6a4f', soil: '#8a6a4f', blooms: ['#f0729a', '#f6c445', '#a77ce0', '#ff8a5c'],
  ctx: { ...CTX.light, leaf: blend(CTX.light.tree, CTX.light.ground, CTX.light.treeOpacity), stem: blend(CTX.light.trunk, CTX.light.ground, CTX.light.treeOpacity) },
};

const dark: typeof light = {
  bg: CTX.dark.ground, ground: '#22392c', green: '#27402f', wood: '#2b4a37', pitch: '#2a4934', pitchLine: '#46664f',
  water: '#2a6466', shore: '#3f8384', road: '#4a5157', roadEdge: '#2c3237', footpath: '#6d6450', footpathEdge: '#4d4636',
  wall: '#6f757c', wallOff: CTX.dark.wall,
  digbyRoof: DARK_ROOFS.digby, froebelRoof: DARK_ROOFS.froebel, southlandsRoof: DARK_ROOFS.southlands, whitelandsRoof: DARK_ROOFS.whitelands, otherRoof: DARK_ROOFS.other, offRoof: CTX.dark.roof,
  digbyRim: DARK_ROOFS.digbyRim, froebelRim: DARK_ROOFS.froebelRim, southlandsRim: DARK_ROOFS.southlandsRim, whitelandsRim: DARK_ROOFS.whitelandsRim, otherRim: DARK_ROOFS.otherRim, offRim: CTX.dark.rim,
  glass: '#e9d8a0', frame: '#4b5157', glassOff: CTX.dark.glass, frameOff: CTX.dark.wall,
  hospWall: '#5d6168', hospGlass: '#e9d8a0', hospRoof: '#686c73', hospRim: '#e06666',
  slate1: '#3f4650', slate2: '#4b535e', slate3: '#58616d', tile1: '#7a4f3f', tile2: '#86594a', tile3: '#926556',
  greenRoof: '#4f7a45', solar: '#2c4058', metal: '#66737d',
  selected: '#ff8a6b', selectedWall: '#8a5d52', trunk: '#6e5340', leaf: '#3f7a4c', leafDark: '#2f6140', accuracy: '#6ea6ff',
  tones: ['#3f7a4c', '#356b42', '#4a8655', '#2f6140', '#557f45'], blossom: '#9a6a7a',
  route: '#ff7f9c', routeCase: '#1b2228', routeFlow: '#ffe3ea', outside: CTX.dark.outside, shadow: 'rgba(0,0,0,0.28)',
  stones: ['#6a4c37', '#5e4331', '#745540'], pier: '#71523c', plinth: '#3a2a1f', coping: '#8a7660', iron: '#0d1a15', lamp: '#ffd36b',
  cars: ['#b9b8b3', '#8b939b', '#3b4148', '#8a4a41', '#4b6683', '#9a8a5f'], carGlass: '#24303a', basin: '#6f6a60', jet: '#7fb9b8',
  fencePost: '#9db2a5', fenceMesh: '#b7c9bd',
  golf: { rough: '#284433', fairway: '#35583f', tee: '#3a5f44', green: '#416a4a', bunker: '#8a7d5a', water: '#2a6466' }, stone: '#77746e', stoneDark: '#5b5953', stoneRoof: '#5f646a', flag: '#ff6b6f', benchWood: '#8a6446', busGlass: '#56707a', busRoof: '#232c31', busPole: '#8a979d', busFlag: '#c94640', coopWood: '#6e4c33', coopRoof: '#7d3a2c', hen: '#d9d8d0', comb: '#b8402f', goalPost: '#d5ddd8', plinthStone: '#7a7468', bronze: '#9a8460', soil: '#4a3a2c', blooms: ['#a55571', '#a88a3a', '#7258a0', '#a8644a'],
  ctx: { ...CTX.dark, leaf: blend(CTX.dark.tree, CTX.dark.ground, CTX.dark.treeOpacity), stem: blend(CTX.dark.trunk, CTX.dark.ground, CTX.dark.treeOpacity) },
};

export const PALETTE: Record<Theme, typeof light> = { light, dark };
export type Pal = typeof light;

/** the UI's college swatches and area-label icons, from the same colours */
export function cssVars(theme: Theme): Record<string, string> {
  const p = PALETTE[theme];
  return {
    '--roof-digby': p.digbyRoof, '--roof-froebel': p.froebelRoof, '--roof-southlands': p.southlandsRoof,
    '--roof-whitelands': p.whitelandsRoof, '--roof-other': p.otherRoof, '--hosp-accent': p.hospRim,
  };
}
