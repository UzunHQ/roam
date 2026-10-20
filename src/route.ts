import { config } from './config';
import { distanceM } from './geo';
import type { LngLat, Place } from './types';

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
  /** true when the place has a verified entrance and the route ends there */
  toEntrance: boolean;
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

  /** node closest to a building outline (any side), or to a point when there is no outline */
  nodeForPlace(place: Place, footprint?: LngLat[]): number {
    if (place.entrance) return this.nearestNode(place.entrance).node;
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

  /** Dijkstra; the graph is small (under 1,000 nodes), so a simple array queue is enough */
  route(from: LngLat | Place, to: Place, footprints: Map<string, LngLat[]>): Route | null {
    const startPt = Array.isArray(from) ? from : from.position;
    const start = Array.isArray(from) ? this.nearestNode(from).node : this.nodeForPlace(from, from.footprintId ? footprints.get(from.footprintId) : undefined);
    const end = this.nodeForPlace(to, to.footprintId ? footprints.get(to.footprintId) : undefined);
    const n = this.g.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevFlag = new Int8Array(n);
    const done = new Uint8Array(n);
    dist[start] = 0;
    const queue = [start];
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (dist[queue[i]] < dist[queue[bi]]) bi = i;
      const u = queue.splice(bi, 1)[0];
      if (done[u]) continue;
      done[u] = 1;
      if (u === end) break;
      for (const { to: v, d, f } of this.adj[u]) {
        const nd = dist[u] + d;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevFlag[v] = f; queue.push(v); }
      }
    }
    if (!Number.isFinite(dist[end])) return null;
    const path: LngLat[] = [];
    let hasSteps = false;
    for (let v = end; v !== -1; v = prev[v]) {
      path.unshift(this.g.nodes[v]);
      if (prevFlag[v] & 1) hasSteps = true;
    }
    const distance = dist[end];
    return {
      coordinates: path,
      distanceM: distance,
      minutes: Math.max(1, Math.round(distance / config.walkingSpeedMps / 60)),
      hasSteps,
      toEntrance: !!to.entrance,
      startHop: [startPt, this.g.nodes[start]],
    };
  }
}
