import type { Place } from './types';

/** The user-facing groups. Derived from category + kind so places.json keeps its shape. */
export const GROUPS = [
  { id: 'academic', label: 'Academic buildings', short: 'Academic' },
  { id: 'library', label: 'Library & study spaces', short: 'Library' },
  { id: 'food', label: 'Food & drink', short: 'Food & drink' },
  { id: 'accommodation', label: 'Accommodation', short: 'Halls' },
  { id: 'sport', label: 'Sport & fitness', short: 'Sport' },
  { id: 'services', label: 'Student services', short: 'Services' },
  { id: 'faith', label: 'Faith & prayer', short: 'Faith' },
  { id: 'outdoors', label: 'Outdoors & parking', short: 'Outdoors' },
  { id: 'entrance', label: 'Campus entrances', short: 'Entrances' },
] as const;

export type GroupId = (typeof GROUPS)[number]['id'];
/** Car parks and open-air spots. Like the entrances they have no chip and stay on the map under any filter. */
const OUTDOOR_KINDS = new Set(['parking', 'fountain', 'garden', 'square', 'monument', 'golf']);

export function groupOf(p: Place): GroupId {
  if (p.category === 'entrance') return 'entrance';
  if (p.category === 'food') return 'food';
  if (p.category === 'sport') return 'sport';
  if (OUTDOOR_KINDS.has(p.kind)) return 'outdoors';
  switch (p.kind) {
    case 'academic': return 'academic';
    case 'library': return 'library';
    case 'accommodation': return 'accommodation';
    case 'faith': return 'faith';
    default: return 'services';
  }
}

export const groupLabel = (id: GroupId) => GROUPS.find((g) => g.id === id)!.label;

/** Higher wins when markers collide on screen. */
export const PRIORITY: Record<GroupId, number> = {
  library: 9, academic: 8, food: 7, sport: 7, services: 6, faith: 5, accommodation: 4, outdoors: 3, entrance: 2,
};

/** The category chips: a few broad filters, each covering one or more groups. */
export const FILTERS = [
  { id: 'study', label: 'Study', full: 'Study: teaching buildings and the library', groups: ['academic', 'library'], icon: 'library' },
  { id: 'food', label: 'Food', full: 'Food & drink', groups: ['food'], icon: 'food' },
  { id: 'living', label: 'Living', full: 'Living: halls of residence', groups: ['accommodation'], icon: 'accommodation' },
  { id: 'sport', label: 'Sport', full: 'Sport & fitness', groups: ['sport'], icon: 'sport' },
  { id: 'essentials', label: 'Essentials', full: 'Essentials: student services and faith spaces', groups: ['services', 'faith'], icon: 'services' },
] as const satisfies readonly { id: string; label: string; full: string; groups: readonly GroupId[]; icon: GroupId }[];

export type FilterId = (typeof FILTERS)[number]['id'];
/** 'all', your saved places, a chip, or a single group picked from search ("Show all: Faith & prayer"). */
export type Filter = 'all' | 'saved' | FilterId | GroupId;

export const filterOf = (g: GroupId): FilterId | null => FILTERS.find((f) => (f.groups as readonly GroupId[]).includes(g))?.id ?? null;
const isGroup = (f: Filter): f is GroupId => GROUPS.some((g) => g.id === f);
export function passesFilter(f: Filter, g: GroupId): boolean {
  if (f === 'all' || f === 'saved') return true; // 'saved' is checked against the saved list in main.ts
  if (isGroup(f)) return g === f;
  return (FILTERS.find((x) => x.id === f)!.groups as readonly GroupId[]).includes(g);
}
export const filterLabel = (f: Filter) => (f === 'all' ? 'All' : f === 'saved' ? 'your saved places' : isGroup(f) ? groupLabel(f) : FILTERS.find((x) => x.id === f)!.full);
/** the chip shown as pressed for a filter */
export const chipOf = (f: Filter): 'all' | 'saved' | FilterId => (f === 'all' || f === 'saved' ? f : isGroup(f) ? (filterOf(f) ?? 'all') : f);
