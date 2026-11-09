// Turns the phone's raw GPS readings into where the character should stand. Pure: no DOM, no map,
// no clock of its own (every reading carries its time), so scripts/check-gps.mjs runs it in Node
// against synthetic walks. main.ts feeds it each reading (onLiveFix) and draws what it returns.
//
// For each reading, in order:
// 1. the first position: a reading worse than 30 m waits up to 4 s for a better one ("Finding you…");
// 2. jumps: a lone reading that would mean moving faster than 7 m/s, even allowing for its own
//    accuracy and the filter's, is dropped; two in a row the same way are a real move and kept;
// 3. a Kalman filter (constant velocity, measurement noise = accuracy², plus the phone's own speed
//    and course when it gives them) smooths the wander;
// 4. standing still (under 0.5 m/s, and less than half the accuracy from where it stood) the
//    character doesn't move at all;
// 5. display only: inside a building with a weak reading (over 20 m), the character waits at the
//    building's edge ("Inside …"); otherwise, with a decent reading, it stands on the route line
//    (while one is shown) or the nearest footpath, never across a building, and sticks to the path
//    it is on until another is clearly nearer.
// Routes (off-route checks) and arrival use the filtered position, never the one moved onto a path.
import type { LngLat } from './types';

export interface GpsReading {
  pos: LngLat;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  time: number;
}
export interface GpsBuilding { name: string | null; ring: LngLat[] }
export interface GpsWorld {
  /** footpath segments (the walking graph's edges) */
  paths: [LngLat, LngLat][];
  buildings: GpsBuilding[];
}
export interface GpsView {
  /** where the character stands */
  shown: LngLat;
  /** the filtered reading: position (not moved onto a path), the reading's accuracy, speed and course */
  fix: GpsReading;
  on: 'route' | 'path' | 'building' | null;
  /** the building it waits outside of (weak reading inside it); '' for one with no name */
  inside: string | null;
  moving: boolean;
}
export type GpsStep = { kind: 'wait' } | { kind: 'reject' } | { kind: 'show'; view: GpsView };

export const GPS = {
  firstGoodM: 30,
  firstWaitMs: 4000,
  maxSpeed: 7,
  stillSpeed: 0.5,
  stillShare: 0.5,
  snapMaxAccuracy: 25,
  snapMaxM: 12,
  /** never less than this, so a phone claiming 1–3 m still sits on a path a few metres off */
  snapMinM: 5,
  /** a route line: up to 15 m, never less than 8 */
  routeMinM: 8,
  routeMaxM: 15,
  /** a path stays chosen until another is this much nearer */
  stickM: 3,
  indoorAccuracy: 20,
  headingSpeed: 1,
  /** the character moves at most this far per reading; it catches up over the next ones */
  maxStepM: 12,
  /** process noise: how hard a walker can change speed (m²/s³) */
  q: 0.1,
};

// ---------- local metres ----------
type XY = [number, number];
const R = 111320;

/** the chosen course: GPS course when walking briskly, else the compass (null: no arrow) */
export function pickHeading(speed: number | null, gpsHeading: number | null, compass: number | null): number | null {
  if (speed != null && speed > GPS.headingSpeed && gpsHeading != null) return gpsHeading;
  return compass;
}

/**
 * Arrival: a decent filtered reading within 12 m of the end (or its accuracy, up to 20 m).
 * main.ts also wants it twice in a row.
 */
export function nearEnd(fix: { pos: LngLat; accuracy: number }, end: LngLat): boolean {
  if (fix.accuracy > 30) return false;
  const k = Math.cos((end[1] * Math.PI) / 180);
  const d = Math.hypot((fix.pos[0] - end[0]) * R * k, (fix.pos[1] - end[1]) * R);
  return d <= Math.max(12, Math.min(fix.accuracy, 20));
}

interface Seg { a: XY; b: XY; box: [number, number, number, number] }
interface Bld { name: string | null; ring: XY[]; box: [number, number, number, number] }

const near = (p: XY, a: XY, b: XY) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  const q: XY = [a[0] + u * dx, a[1] + u * dy];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
};
const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** proper crossing of two segments (touching ends don't count) */
const crosses = (p1: XY, p2: XY, q1: XY, q2: XY) => {
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
};
const inRing = (p: XY, ring: XY[]) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
};
const boxOf = (pts: XY[]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
const inBox = (p: XY, b: [number, number, number, number], pad: number) => p[0] >= b[0] - pad && p[0] <= b[2] + pad && p[1] >= b[1] - pad && p[1] <= b[3] + pad;

// ---------- the filter ----------
/** one axis of a constant-velocity Kalman filter: position p, velocity v, covariance P */
class Axis {
  p: number; v = 0; P: [number, number, number, number]; // P00, P01, P10, P11
  constructor(z: number, r: number) { this.p = z; this.P = [r, 0, 0, 4]; }
  predict(dt: number, q: number) {
    const [a, b, c, d] = this.P;
    this.p += this.v * dt;
    // F P F' + Q, F = [[1, dt], [0, 1]], Q = q [[dt³/3, dt²/2], [dt²/2, dt]]
    const a2 = a + dt * (b + c) + dt * dt * d + (q * dt ** 3) / 3;
    const b2 = b + dt * d + (q * dt * dt) / 2;
    this.P = [a2, b2, c + dt * d + (q * dt * dt) / 2, d + q * dt];
  }
  /** a position measurement z with variance r */
  pos(z: number, r: number) {
    const [a, b, c, d] = this.P, s = a + r, k0 = a / s, k1 = c / s, y = z - this.p;
    this.p += k0 * y; this.v += k1 * y;
    this.P = [(1 - k0) * a, (1 - k0) * b, c - k1 * a, d - k1 * b];
  }
  /** a velocity measurement z with variance r */
  vel(z: number, r: number) {
    const [a, b, c, d] = this.P, s = d + r, k0 = b / s, k1 = d / s, y = z - this.v;
    this.p += k0 * y; this.v += k1 * y;
    this.P = [a - k0 * c, b - k0 * d, (1 - k1) * c, (1 - k1) * d];
  }
}

export class GpsFilter {
  private o: LngLat;
  private kx: number;
  private segs: Seg[];
  private blds: Bld[];
  private route: Seg[] = [];
  private x: Axis | null = null;
  private y: Axis | null = null;
  private lastT = 0;
  private waiting: GpsReading[] = [];
  private jump: { r: GpsReading; xy: XY } | null = null;
  private held: XY | null = null;
  private heldAcc = Infinity;
  /** standing still: the character stays at `held` and the filter's speed is held at zero */
  private still = true;
  private stillRun = 0;
  private phoneRun = 0;
  private driftRun = 0;
  /** the last 5 s of readings and of filtered positions */
  private raw: { t: number; z: XY }[] = [];
  private hist: { t: number; p: XY }[] = [];
  private onPath = -1;
  private indoor: { b: number; at: XY } | null = null;
  private lastShown: XY | null = null;
  private lastOn: GpsView['on'] = null;
  /** the last position the character was placed from (before moving onto a path) */
  private lastBase: XY | null = null;
  /** what was shown when it stopped: kept as it is while it stands */
  private frozen: { at: XY; on: GpsView['on']; inside: string | null } | null = null;

  constructor(world: GpsWorld) {
    const pts = world.paths.flat();
    this.o = pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : [0, 0];
    this.kx = R * Math.cos((this.o[1] * Math.PI) / 180);
    this.segs = world.paths.map(([a, b]) => this.seg(this.xy(a), this.xy(b)));
    this.blds = world.buildings.filter((b) => b.ring.length >= 4).map((b) => { const ring = b.ring.map((p) => this.xy(p)); return { name: b.name, ring, box: boxOf(ring) }; });
  }
  private seg(a: XY, b: XY): Seg { return { a, b, box: boxOf([a, b]) }; }
  xy(p: LngLat): XY { return [(p[0] - this.o[0]) * this.kx, (p[1] - this.o[1]) * R]; }
  ll([x, y]: XY): LngLat { return [this.o[0] + x / this.kx, this.o[1] + y / R]; }

  /** the route line shown (null: none); the character then stands on it first */
  setRoute(line: LngLat[] | null) {
    const pts = (line ?? []).map((p) => this.xy(p));
    this.route = pts.slice(1).map((b, i) => this.seg(pts[i], b));
  }

  /** forget everything (GPS restarted after a long pause) */
  reset() {
    this.x = this.y = null; this.waiting = []; this.jump = null; this.held = null; this.onPath = -1; this.indoor = null; this.lastShown = null; this.lastOn = null; this.frozen = null; this.lastBase = null;
    this.still = true; this.stillRun = this.phoneRun = this.driftRun = 0; this.raw = []; this.hist = [];
  }

  get started() { return !!this.x; }

  /** a new reading */
  push(r: GpsReading): GpsStep {
    if (!this.x) {
      this.waiting.push(r);
      if (r.accuracy > GPS.firstGoodM && r.time - this.waiting[0].time < GPS.firstWaitMs) return { kind: 'wait' };
      return this.start();
    }
    const z = this.xy(r.pos);
    const dt = Math.max(0.2, (r.time - this.lastT) / 1000);
    // a long gap (GPS paused): start again from this reading
    if (dt > 60) { this.reset(); this.waiting = [r]; return this.start(); }
    const sigma = Math.sqrt(Math.max(this.x.P[0], this.y!.P[0]));
    const d = Math.hypot(z[0] - this.x.p, z[1] - this.y!.p);
    if ((d - r.accuracy - sigma) / dt > GPS.maxSpeed) {
      // too fast for a walker: one is a glitch; a second one the same way is a real move
      const j = this.jump;
      if (j) {
        const from: XY = [this.x.p, this.y!.p];
        const a1 = Math.atan2(j.xy[1] - from[1], j.xy[0] - from[0]), a2 = Math.atan2(z[1] - from[1], z[0] - from[0]);
        const turn = Math.abs(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        const gap = Math.hypot(z[0] - j.xy[0], z[1] - j.xy[1]);
        const dtj = Math.max(0.2, (r.time - j.r.time) / 1000);
        if (turn < Math.PI / 4 && gap <= j.r.accuracy + r.accuracy + GPS.maxSpeed * dtj) {
          this.reset(); this.waiting = [r]; return this.start();
        }
      }
      this.jump = { r, xy: z };
      return { kind: 'reject' };
    }
    this.jump = null;
    this.x.predict(dt, GPS.q); this.y!.predict(dt, GPS.q);
    this.measure(r, z);
    this.motion(r, z);
    this.lastT = r.time;
    return { kind: 'show', view: this.view(r) };
  }

  /** stop waiting for a better first reading: use the best so far (main.ts calls this after 4 s) */
  flush(): GpsStep {
    if (this.x || !this.waiting.length) return { kind: 'wait' };
    return this.start();
  }

  private start(): GpsStep {
    const best = this.waiting.reduce((a, b) => (b.accuracy < a.accuracy ? b : a));
    // the latest reading's time: later readings follow on from now
    const now = this.waiting[this.waiting.length - 1].time;
    this.waiting = [];
    const z = this.xy(best.pos), rr = best.accuracy ** 2;
    this.x = new Axis(z[0], rr); this.y = new Axis(z[1], rr);
    this.x.vel(0, 0.36); this.y.vel(0, 0.36);
    this.still = true; this.held = z; this.stillRun = this.phoneRun = 0;
    this.raw = [{ t: now, z }]; this.hist = [{ t: now, p: z }];
    this.lastT = now;
    return { kind: 'show', view: this.view({ ...best, time: now }) };
  }

  private measure(r: GpsReading, z: XY) {
    const rr = Math.max(1, r.accuracy) ** 2;
    this.x!.pos(z[0], rr); this.y!.pos(z[1], rr);
    // the phone's own speed (Doppler) is far steadier than differences of positions
    if (r.speed != null) {
      if (r.heading != null && r.speed >= 0.3) {
        const h = (r.heading * Math.PI) / 180;
        this.x!.vel(r.speed * Math.sin(h), 0.36); this.y!.vel(r.speed * Math.cos(h), 0.36);
      } else if (r.speed < 0.3) { this.x!.vel(0, 0.36); this.y!.vel(0, 0.36); }
    }
  }

  /**
   * Standing still or walking. Still: under 0.5 m/s and less than half the accuracy from where it
   * was 5 s ago, three readings running. Then the speed is held at zero (a "zero velocity update"),
   * so the filter averages the readings instead of chasing the noise, and the character stays put.
   * Walking again: the phone says so twice, or three times running the last 5 s of readings have
   * clearly left the spot (by more than half the accuracy, and by more than 3.5 standard errors of
   * their mean; a phone's accuracy is a 68% radius, about 1.5 standard deviations per axis). With
   * the phone's speed that's two readings. Without it, and readings scattered ±8 m, it takes about
   * 15–20 s (synthetic, scripts/check-gps.mjs): the price of a character that doesn't wander while
   * you stand (no false start in 1,000 synthetic two-minute stands).
   */
  private motion(r: GpsReading, z: XY) {
    const x = this.x!, y = this.y!, t = r.time, p: XY = [x.p, y.p];
    this.raw = [...this.raw.filter((e) => t - e.t < 5000), { t, z }];
    this.hist = [...this.hist.filter((e) => t - e.t <= 5000), { t, p }];
    if (this.still) {
      this.phoneRun = r.speed != null && r.speed >= GPS.stillSpeed ? this.phoneRun + 1 : 0;
      const n = this.raw.length;
      const mx = this.raw.reduce((s, e) => s + e.z[0], 0) / n, my = this.raw.reduce((s, e) => s + e.z[1], 0) / n;
      const lim = Math.max(r.accuracy * GPS.stillShare, (3.5 * r.accuracy) / 1.5 / Math.sqrt(n));
      this.driftRun = n >= 3 && Math.hypot(mx - p[0], my - p[1]) > lim ? this.driftRun + 1 : 0;
      if (this.phoneRun >= 2 || this.driftRun >= 3) {
        // off again: let the filter catch up with the readings at once
        this.still = false; this.stillRun = this.driftRun = 0;
        const rr = r.accuracy ** 2;
        x.P = [4 * rr, 0, 0, 4]; y.P = [4 * rr, 0, 0, 4];
        x.pos(mx, rr / n); y.pos(my, rr / n);
        x.pos(z[0], rr); y.pos(z[1], rr);
        this.hist = [{ t, p: [x.p, y.p] }];
      } else { x.vel(0, 0.01); y.vel(0, 0.01); }
      return;
    }
    const speed = r.speed ?? Math.hypot(x.v, y.v);
    const was = this.hist[0].p;
    const slow = speed < GPS.stillSpeed && Math.hypot(p[0] - was[0], p[1] - was[1]) < r.accuracy * GPS.stillShare;
    this.stillRun = slow ? this.stillRun + 1 : 0;
    if (this.stillRun >= 3) { this.still = true; this.held = p; this.phoneRun = this.driftRun = 0; x.vel(0, 0.01); y.vel(0, 0.01); }
  }

  private view(r: GpsReading): GpsView {
    const x = this.x!, y = this.y!;
    const p: XY = [x.p, y.p];
    const still = this.still;
    const v = Math.hypot(x.v, y.v);
    const speed = still ? 0 : (r.speed ?? v);
    const heading = still ? null : (r.heading ?? (v > GPS.stillSpeed ? ((Math.atan2(x.v, y.v) * 180) / Math.PI + 360) % 360 : null));
    const fix: GpsReading = { pos: this.ll(p), accuracy: r.accuracy, speed, heading, time: r.time };
    // standing still: stay put
    let base = p;
    // (a much better reading than the one it stopped on moves it once: the first position may have been rough)
    if (still && this.held && r.accuracy >= this.heldAcc / 2) {
      base = this.held;
      const f = this.frozen;
      if (f) return { shown: this.ll(f.at), fix, on: f.on, inside: f.inside, moving: false };
    } else { this.held = p; this.heldAcc = r.accuracy; this.frozen = null; }
    // no leaps: after a while standing (or a much better reading) it catches up a step at a time
    const lb = this.lastBase;
    if (lb) {
      const dx = base[0] - lb[0], dy = base[1] - lb[1], d = Math.hypot(dx, dy);
      if (d > GPS.maxStepM) base = [lb[0] + (dx * GPS.maxStepM) / d, lb[1] + (dy * GPS.maxStepM) / d];
    }
    this.lastBase = base;
    const v2 = this.place(base, r, fix, !still);
    // frozen only once it has caught up with where it stopped
    const there = base[0] === this.held![0] && base[1] === this.held![1];
    this.frozen = still && there ? { at: this.lastShown!, on: v2.on, inside: v2.inside } : null;
    return v2;
  }

  private place(base: XY, r: GpsReading, fix: GpsReading, moving: boolean): GpsView {

    // a weak reading inside a building: wait at its edge
    const b = r.accuracy > GPS.indoorAccuracy ? this.blds.findIndex((bl) => inBox(base, bl.box, 0) && inRing(base, bl.ring)) : -1;
    if (b >= 0) {
      if (this.indoor?.b !== b) {
        const from = this.lastShown ?? base;
        let best: XY = from, bd = Infinity;
        const ring = this.blds[b].ring;
        for (let i = 1; i < ring.length; i++) { const n = near(from, ring[i - 1], ring[i]); if (n.d < bd) { bd = n.d; best = n.q; } }
        this.indoor = { b, at: best };
      }
      this.onPath = -1;
      return this.out(this.indoor.at, fix, 'building', this.blds[b].name ?? '', moving);
    }
    this.indoor = null;

    // once on a path, a little more slack to stay on it (no flicking on and off at the limit)
    const slack = (on: GpsView['on']) => (this.lastOn === on ? GPS.stickM : 0);
    if (r.accuracy <= GPS.snapMaxAccuracy + (this.lastOn ? 5 : 0)) {
      if (this.route.length) {
        const lim = Math.min(Math.max(r.accuracy, GPS.routeMinM), GPS.routeMaxM) + slack('route');
        const q = this.snap(base, this.route, lim, -1);
        if (q) { this.onPath = -1; return this.out(q.q, fix, 'route', null, moving); }
      }
      const lim = Math.min(Math.max(r.accuracy, GPS.snapMinM), GPS.snapMaxM) + slack('path');
      const q = this.snap(base, this.segs, lim, this.onPath);
      if (q) { this.onPath = q.i; return this.out(q.q, fix, 'path', null, moving); }
    }
    this.onPath = -1;
    return this.out(base, fix, null, null, moving);
  }

  private out(at: XY, fix: GpsReading, on: GpsView['on'], inside: string | null, moving: boolean): GpsView {
    this.lastShown = at; this.lastOn = on;
    return { shown: this.ll(at), fix, on, inside, moving };
  }

  /** the nearest point on `segs` within `lim` metres reached without crossing a building; sticks to `keep` */
  private snap(p: XY, segs: Seg[], lim: number, keep: number): { q: XY; i: number } | null {
    const cands: { q: XY; d: number; i: number }[] = [];
    segs.forEach((s, i) => {
      if (!inBox(p, s.box, lim)) return;
      const n = near(p, s.a, s.b);
      if (n.d <= lim) cands.push({ ...n, i });
    });
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    const ok = (c: { q: XY }) => !this.blocked(p, c.q);
    const kept = keep >= 0 ? cands.find((c) => c.i === keep) : undefined;
    const best = cands.find(ok);
    if (!best) return null;
    if (kept && kept !== best && kept.d <= best.d + GPS.stickM && ok(kept)) return kept;
    return best;
  }

  /** the step from p to q passes through a building, or q is inside one */
  private blocked(p: XY, q: XY): boolean {
    const box = boxOf([p, q]);
    for (const b of this.blds) {
      if (b.box[0] > box[2] || b.box[2] < box[0] || b.box[1] > box[3] || b.box[3] < box[1]) continue;
      if (inRing(q, b.ring)) return true;
      for (let i = 1; i < b.ring.length; i++) if (crosses(p, q, b.ring[i - 1], b.ring[i])) return true;
    }
    return false;
  }
}
