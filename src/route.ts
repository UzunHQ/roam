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
}

export class Router {
  private adj: { to: number; d: number; f: number }[][];

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

  /** the nodes a route to (or from) a place may end at: one per usable door, else the one by the building */
  private endsFor(place: Place, footprint?: LngLat[]): Map<number, Entrance | null> {
    const doors = Router.doors(place);
    if (doors.length) return new Map(doors.map((e) => [this.nearestNode(e.pos).node, e]));
    return new Map([[this.nodeForPlace(place, footprint), null]]);
  }

  /** Dijkstra; the graph is small (under 1,000 nodes), so a simple array queue is enough */
  route(from: LngLat | Place, to: Place, footprints: Map<string, LngLat[]>): Route | null {
    const startPt = Array.isArray(from) ? from : from.position;
    const starts = Array.isArray(from) ? [this.nearestNode(from).node] : [...this.endsFor(from, from.footprintId ? footprints.get(from.footprintId) : undefined).keys()];
    const ends = this.endsFor(to, to.footprintId ? footprints.get(to.footprintId) : undefined);
    const n = this.g.nodes.length;
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
      for (const { to: v, d, f } of this.adj[u]) {
        const nd = dist[u] + d;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevFlag[v] = f; queue.push(v); }
      }
    }
    if (end < 0) return null;
    const path: LngLat[] = [];
    let hasSteps = false;
    let first = end;
    for (let v = end; v !== -1; v = prev[v]) {
      path.unshift(this.g.nodes[v]);
      if (prevFlag[v] & 1) hasSteps = true;
      first = v;
    }
    const door = ends.get(end) ?? null;
    if (door) path.push(door.pos); // the last few metres from the path to the door itself
    const distance = dist[end] + (door ? distanceM(this.g.nodes[end], door.pos) : 0);
    return {
      coordinates: path,
      distanceM: distance,
      minutes: Math.max(1, Math.round(distance / config.walkingSpeedMps / 60)),
      hasSteps,
      toEntrance: !!door,
      endsAt: !door ? 'nearest-path' : door.verified ? 'entrance-verified' : 'entrance-unverified',
      door,
      startHop: [startPt, this.g.nodes[first]],
    };
  }
}
