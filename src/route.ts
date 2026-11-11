import { config } from './config';
import { distanceM } from './geo';
import type { Entrance, LngLat, Place } from './types';

/** data/paths.json, built from OSM by scripts/build-paths.mjs */
export interface PathGraph {
  nodes: LngLat[];
  /** [from, to, metres, flags]; flags 1 = steps, 2 = private campus way */
  edges: [number, number, number, number][];
}

export interface Route {
  /** walking line along mapped paths */
  coordinates: LngLat[];
  /** metres along the paths only (the short hops to and from the path are not added) */
  distanceM: number;
  minutes: number;
  hasSteps: boolean;
  /** true when the route ends at one of the place's entrances (verified or not: see endsAt) */
  toEntrance: boolean;
  /** how far the end can be trusted: a checked door, a door not yet checked, or just the path nearest the building */
  endsAt: 'entrance-verified' | 'entrance-unverified' | 'nearest-path';
  /** the door it ends at, if any */
  door: Entrance | null;
  /** straight hop from the start point to the first path node, shown faintly */
  startHop: LngLat[];
  /**
   * The last stretch to the door when no mapped path leads to it and the straight line there
   * crosses a building (a door in a courtyard): from the path to the door, shown faintly like
   * startHop. Empty when the door is reached by the route line itself.
   */
  endHop: LngLat[];
}

/** how far a door may be from the path it joins */
const REACH_M = 60;
/** where a door joins the paths: a point q on the edge a–b, the walk from q to each end, and the door's own few metres (hop) */
interface Link { a: number; b: number; q: LngLat; da: number; db: number; f: number; hop: number; clear: boolean }
/** do the segments p1–p2 and p3–p4 cross? (flat coordinates) */
function crosses(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean {
  const o = (a: [number, number], b: [number, number], c: [number, number]) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, p3) !== o(p1, p2, p4) && o(p3, p4, p1) !== o(p3, p4, p2);
}

export class Router {
  private adj: { to: number; d: number; f: number }[][];
  private links = new Map<string, Link>();

  constructor(private g: PathGraph) {
    this.adj = g.nodes.map(() => []);
    for (const [a, b, d, f] of g.edges) {
      this.adj[a].push({ to: b, d, f });
      this.adj[b].push({ to: a, d, f });
    }
  }

  nearestNode(p: LngLat): { node: number; d: number } {
    let node = 0, d = Infinity;
    this.g.nodes.forEach((n, i) => {
      const di = distanceM(p, n);
      if (di < d) { d = di; node = i; }
    });
    return { node, d };
  }

  /** the doors a route may use: checked ones if there are any, else unchecked ones; never closed ones */
  static doors(place: Place): Entrance[] {
    const all: Entrance[] = [...(place.entrances ?? []), ...(place.entrance ? [{ pos: place.entrance, type: 'main' as const, verified: false }] : [])]
      .filter((e) => e.type !== 'closed');
    const checked = all.filter((e) => e.verified);
    return checked.length ? checked : all;
  }

  /** node closest to a building outline (any side), or to a point when there is no outline */
  nodeForPlace(place: Place, footprint?: LngLat[]): number {
    if (!footprint) return this.nearestNode(place.position).node;
    let node = 0, d = Infinity;
    this.g.nodes.forEach((n, i) => {
      for (const v of footprint) {
        const di = distanceM(n, v);
        if (di < d) { d = di; node = i; }
      }
    });
    return node;
  }

  /**
   * Where a door joins the paths: the nearest point on any path that has a clear line to the door
   * (not through a building), within REACH_M. With no clear line in reach, simply the nearest
   * point; with no path in reach at all, the nearest node. Worked out once for each door.
   */
  private link(pos: LngLat, footprints: Map<string, LngLat[]>): Link {
    const key = `${pos[0]},${pos[1]}`;
    const known = this.links.get(key);
    if (known) return known;
    const kx = 111320 * Math.cos((pos[1] * Math.PI) / 180), ky = 110540;
    const xy = (p: LngLat): [number, number] => [(p[0] - pos[0]) * kx, (p[1] - pos[1]) * ky]; // metres from the door
    const cands: (Link & { x: number; y: number })[] = [];
    for (const [a, b, d, f] of this.g.edges) {
      const A = xy(this.g.nodes[a]), B = xy(this.g.nodes[b]);
      const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / l2)) : 0;
      const x = A[0] + t * dx, y = A[1] + t * dy, hop = Math.hypot(x, y);
      if (hop <= REACH_M) cands.push({ a, b, q: [pos[0] + x / kx, pos[1] + y / ky], da: t * d, db: (1 - t) * d, f, hop, clear: true, x, y });
    }
    cands.sort((p, q) => p.hop - q.hop);
    const walls = [...footprints.values()].map((ring) => ring.map(xy));
    // the door is on its own building's wall: the line is tested from just outside it
    const blocked = (c: { x: number; y: number; hop: number }) => {
      if (c.hop < 1) return false;
      const near: [number, number] = [(c.x * 0.6) / c.hop, (c.y * 0.6) / c.hop];
      return walls.some((ring) => ring.some((v, i) => i > 0 && crosses([c.x, c.y], near, ring[i - 1], v)));
    };
    let best: Link | undefined = cands.find((c) => !blocked(c));
    if (!best && cands[0]) best = { ...cands[0], clear: false };
    if (!best) { const { node, d } = this.nearestNode(pos); best = { a: node, b: node, q: this.g.nodes[node], da: 0, db: 0, f: 0, hop: d, clear: false }; }
    const link: Link = { a: best.a, b: best.b, q: best.q, da: best.da, db: best.db, f: best.f, hop: best.hop, clear: best.clear };
    this.links.set(key, link);
    return link;
  }

  /** for the data checks: how a door joins the paths (metres from the path, and whether the line there is clear of buildings) */
  joinOf(pos: LngLat, footprints: Map<string, LngLat[]>): { hop: number; clear: boolean; at: LngLat } {
    const l = this.link(pos, footprints);
    return { hop: l.hop, clear: l.clear, at: l.q };
  }

  /**
   * Dijkstra; the graph is small (under 2,000 nodes), so a simple array queue is enough. A door
   * joins the graph as a node of its own (see link), so a route starts and ends at the door
   * itself, by the nearest point of the path beside it rather than the nearest junction.
   */
  route(from: LngLat | Place, to: Place, footprints: Map<string, LngLat[]>): Route | null {
    const real = this.g.nodes.length;
    const extra: LngLat[] = []; // the doors' own nodes: index real + i
    const out = new Map<number, { to: number; d: number; f: number }[]>(); // their edges, by the node they leave
    const add = (u: number, e: { to: number; d: number; f: number }) => { const l = out.get(u); if (l) l.push(e); else out.set(u, [e]); };
    const at = (v: number) => (v < real ? this.g.nodes[v] : extra[v - real]);
    const joined: { id: number; l: Link }[] = [];
    const join = (e: Entrance) => { const l = this.link(e.pos, footprints); const id = real + extra.length; extra.push(l.q); joined.push({ id, l }); return { id, l }; };

    let startPt: LngLat;
    const starts: number[] = [];
    const startDoors = new Map<number, Entrance>();
    if (Array.isArray(from)) {
      startPt = from;
      starts.push(this.nearestNode(from).node);
    } else {
      startPt = from.position;
      const doors = Router.doors(from);
      for (const e of doors) {
        const { id, l } = join(e);
        add(id, { to: l.a, d: l.da + l.hop, f: l.f });
        add(id, { to: l.b, d: l.db + l.hop, f: l.f });
        starts.push(id);
        startDoors.set(id, e);
      }
      if (!doors.length) starts.push(this.nodeForPlace(from, from.footprintId ? footprints.get(from.footprintId) : undefined));
    }
    const ends = new Map<number, Entrance | null>();
    const toDoors = Router.doors(to);
    for (const e of toDoors) {
      const { id, l } = join(e);
      add(l.a, { to: id, d: l.da + l.hop, f: l.f });
      add(l.b, { to: id, d: l.db + l.hop, f: l.f });
      // two doors on the same stretch of path: straight along it, not round by its end
      for (const s of joined) if (startDoors.has(s.id) && ((s.l.a === l.a && s.l.b === l.b) || (s.l.a === l.b && s.l.b === l.a))) add(s.id, { to: id, d: Math.abs((s.l.a === l.a ? s.l.da : s.l.db) - l.da) + s.l.hop + l.hop, f: l.f });
      ends.set(id, e);
    }
    if (!toDoors.length) ends.set(this.nodeForPlace(to, to.footprintId ? footprints.get(to.footprintId) : undefined), null);
    const n = real + extra.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevFlag = new Int8Array(n);
    const done = new Uint8Array(n);
    for (const s of starts) dist[s] = 0;
    const queue = [...starts];
    let end = -1;
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (dist[queue[i]] < dist[queue[bi]]) bi = i;
      const u = queue.splice(bi, 1)[0];
      if (done[u]) continue;
      done[u] = 1;
      if (ends.has(u)) { end = u; break; } // the nearest usable door
      const extraOut = out.get(u);
      for (const { to: v, d, f } of extraOut ? [...(u < real ? this.adj[u] : []), ...extraOut] : this.adj[u]) {
        const nd = dist[u] + d;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevFlag[v] = f; queue.push(v); }
      }
    }
    if (end < 0) return null;
    const path: LngLat[] = [];
    let hasSteps = false;
    let first = end;
    for (let v = end; v !== -1; v = prev[v]) {
      path.unshift(at(v));
      if (prevFlag[v] & 1) hasSteps = true;
      first = v;
    }
    const door = ends.get(end) ?? null;
    const endLink = door ? joined.find((j) => j.id === end)?.l : undefined;
    const offPath = !!door && !!endLink && !endLink.clear; // no clear line from the path to this door
    if (door && !offPath) path.push(door.pos); // the last few metres from the path to the door itself
    const distance = dist[end]; // (the doors' few metres are in their edges)
    const startDoor = startDoors.get(first);
    return {
      coordinates: path,
      distanceM: distance,
      minutes: Math.max(1, Math.round(distance / config.walkingSpeedMps / 60)),
      hasSteps,
      toEntrance: !!door,
      endsAt: !door ? 'nearest-path' : door.verified ? 'entrance-verified' : 'entrance-unverified',
      door,
      startHop: [startDoor ? startDoor.pos : startPt, at(first)],
      endHop: offPath && door && endLink ? [endLink.q, door.pos] : [],
    };
  }
}
