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
  { id: 'entrance', label: 'Campus entrances', short: 'Entrances' },
] as const;

export type GroupId = (typeof GROUPS)[number]['id'];

export function groupOf(p: Place): GroupId {
  if (p.category === 'entrance') return 'entrance';
  if (p.category === 'food') return 'food';
  if (p.category === 'sport') return 'sport';
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
  library: 9, academic: 8, food: 7, sport: 7, services: 6, faith: 5, accommodation: 4, entrance: 2,
};
