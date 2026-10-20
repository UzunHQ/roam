export type LngLat = [number, number];
export type Category = 'building' | 'food' | 'sport' | 'entrance';
export type College = 'digby-stuart' | 'froebel' | 'southlands' | null;
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type Hours = Partial<Record<Day, [string, string][]>> & { notes?: string };

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
  entrance: LngLat | null;
  footprintId: string | null;
  hours: Hours | null;
  photo: string | null;
  lastVerified: string | null;
  status: 'confirmed' | 'pending-legend';
  // verified content (optional; only filled from official sources)
  officialUrl?: string | null;
  services?: string[];
  accessibility?: { url: string; summary: string } | null;
  sources?: { url: string; title: string; checked: string }[];
}

export interface PlacesDoc {
  site: string;
  bounds: [number, number, number, number];
  places: Place[];
}
