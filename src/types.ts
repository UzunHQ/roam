export type LngLat = [number, number];
export type Category = 'building' | 'food' | 'sport' | 'entrance' | 'nearby';
export type College = 'digby-stuart' | 'froebel' | 'southlands' | null;
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * A way into a building. Only from a check on site or an official source: "verified" says which.
 * main: the usual front door · accessible: step-free way in · card-required: needs a student/staff
 * card · closed: there, but not in use (never routed to).
 */
export interface Entrance {
  pos: LngLat;
  type: 'main' | 'accessible' | 'card-required' | 'closed';
  name?: string; // "Front door on Digby Square"
  verified: boolean;
  source?: string; // "Checked on site", or a URL
  checked?: string; // YYYY-MM-DD
}

export interface Place {
  id: string;
  code: string;
  name: string;
  aliases: string[];
  roomCodePrefixes: string[];
  category: Category;
  kind: string;
  college: College;
  description: string;
  position: LngLat;
  positionSource: string;
  positionAccuracyM: number;
  /** old single entrance point (kept for older data; read as an unverified main door) */
  entrance: LngLat | null;
  entrances?: Entrance[];
  footprintId: string | null;
  photo: string | null;
  lastVerified: string | null;
  status: 'confirmed' | 'pending-legend';
  // verified content (optional; only filled from official sources)
  officialUrl?: string | null;
  services?: string[];
  /** extra search words for what a place offers ("printing", "lecture theatre"); only from a verified source */
  tags?: string[];
  /** not on the Roehampton Lane campus (a hall down the road, a bus stop): walking routes don't cover it */
  offCampus?: boolean;
  /** rooms whose spot inside has been checked (floor, which door). Only filled from a verified source. */
  rooms?: Record<string, { floor?: string; entrance?: string; note?: string; source: string; checked: string }>;
  accessibility?: { url: string; summary: string } | null;
  sources?: { url: string; title: string; checked: string }[];
}

export interface PlacesDoc {
  site: string;
  bounds: [number, number, number, number];
  places: Place[];
}
