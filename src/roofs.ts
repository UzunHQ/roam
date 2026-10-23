// Roof types, read from the aerial 3D view (Apple Maps), checked 20 Oct 2026.
// Only buildings that could be matched with confidence are listed; everything else keeps the
// plain flat roof. Keyed by OSM id, so it survives `npm run build:campus`.
//
//   slate  - pitched slate roof (grey), drawn as a stepped low-poly hip roof
//   tile   - pitched clay-tile roof (terracotta), same shape
//   green  - flat roof with planted (sedum) areas
//   solar  - flat roof with solar panels
//   metal  - light metal roof (halls and auditoria)
//   flat   - plain flat roof (the default)
export type RoofKind = 'slate' | 'tile' | 'green' | 'solar' | 'metal' | 'flat';

export const ROOFS: Record<string, RoofKind> = {
  // Froebel: the three halls by Clarence Lane and the auditorium between them
  'way/629613428': 'slate', // Willow House
  'way/629613430': 'slate', // Aspen House
  'way/629613424': 'slate', // Linden House
  'way/629613432': 'metal', // The Jebb Auditorium
  // Froebel: sports
  'relation/8763239': 'solar', // Davies
  // Digby Stuart
  'way/624430550': 'solar', // Library
  'relation/8673531': 'green', // Elm Grove (west half of the same block)
  'relation/8673532': 'green', // Elm Grove Hall
  'way/653472791': 'slate', // Richardson
  'way/629613445': 'tile', // Newman House
  'way/624679297': 'tile', // Howard
  'way/623519888': 'slate', // Digby Chapel
  'way/624679296': 'slate', // Sacred Heart Chapel
  'way/653472808': 'slate', // Erasmus House
  'way/653472807': 'slate', // Bede House
  'way/653472806': 'slate', // the laundry block between Bede and Erasmus
  // Southlands
  'way/629613442': 'slate', // Shaw House
};

export const isPitched = (k: RoofKind | undefined) => k === 'slate' || k === 'tile';
