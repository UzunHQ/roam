import { distanceM, formatDistance } from './geo';
import type { LngLat } from './types';

/**
 * Walking directions as text, from the route line alone: which way to head, where to turn, and
 * how far. A landmark is only named when a mapped place stands right by the turn; nothing is made
 * up about signs or doors.
 */
export interface Step { text: string; distanceM: number }

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** metres east and north of `o` */
const local = (p: LngLat, o: LngLat): [number, number] => [(p[0] - o[0]) * 111320 * Math.cos((o[1] * Math.PI) / 180), (p[1] - o[1]) * 111320];
const bearing = (a: LngLat, b: LngLat) => { const [x, y] = local(b, a); return (Math.atan2(x, y) * 180) / Math.PI; };

/** Douglas-Peucker in metres: drops the small wiggles of a mapped footpath, keeps the real bends */
function simplify(line: LngLat[], tol: number): LngLat[] {
  if (line.length < 3) return line;
  const o = line[0];
  const xy = line.map((p) => local(p, o));
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let worst = -1, wd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0 && wd > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

function turnWord(angle: number): string {
  const side = angle < 0 ? 'left' : 'right';
  const a = Math.abs(angle);
  if (a < 60) return `Bear ${side}`;
  if (a < 135) return `Turn ${side}`;
  return `Turn sharp ${side}`;
}

export function routeSteps(
  line: LngLat[],
  opts: {
    /** the start, e.g. "Main entrance"; null when starting from your own position */
    from: string | null;
    /** metres from the start point to the first path, walked off-path */
    startHopM: number;
    dest: string;
    /** what the last line says about where it ends */
    arrive: string;
    /** a mapped place right by a point, if any ("the Library", "Shaw House") */
    landmark?: (p: LngLat) => string | null;
  },
): Step[] {
  const pts = simplify(line, 6);
  // legs between real bends; a bend under 35° is part of the same leg
  const legs: { from: LngLat; to: LngLat; d: number; head: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = distanceM(pts[i - 1], pts[i]);
    if (d < 0.5) continue;
    const head = bearing(pts[i - 1], pts[i]);
    const last = legs[legs.length - 1];
    const turn = last ? ((head - last.head + 540) % 360) - 180 : 0;
    // short jogs (under 15 m) and gentle bends fold into the leg before
    if (last && (Math.abs(turn) < 35 || d < 15)) { last.to = pts[i]; last.d += d; last.head = bearing(last.from, pts[i]); continue; }
    legs.push({ from: pts[i - 1], to: pts[i], d, head });
  }
  const steps: Step[] = [];
  if (opts.from) steps.push({ text: `Start at ${opts.from}.`, distanceM: 0 });
  if (opts.startHopM > 15) steps.push({ text: `Walk to the nearest path, about ${formatDistance(opts.startHopM)}.`, distanceM: opts.startHopM });
  legs.forEach((leg, i) => {
    const dist = formatDistance(leg.d);
    if (i === 0) {
      // a building you can see beats a compass point; the compass is the fallback
      const ahead = opts.landmark?.(leg.to) ?? (legs.length === 1 ? opts.dest : null);
      steps.push({ text: ahead ? `Head towards ${ahead} for ${dist}.` : `Head ${compass(leg.head)} for ${dist}.`, distanceM: leg.d });
      return;
    }
    const turn = ((leg.head - legs[i - 1].head + 540) % 360) - 180;
    const near = opts.landmark?.(leg.from);
    const ahead = i < legs.length - 1 ? opts.landmark?.(leg.to) : null;
    steps.push({ text: `${turnWord(turn)}${near ? ` by ${near}` : ''} and walk ${dist}${ahead && ahead !== near ? ` towards ${ahead}` : ''}.`, distanceM: leg.d });
  });
  steps.push({ text: opts.arrive, distanceM: 0 });
  return steps;
}
