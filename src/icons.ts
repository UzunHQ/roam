// Small inline SVG icons (no icon font, works offline). 24x24, currentColor.
const svg = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;

export const icons = {
  building: svg('<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/><path d="M9 10h.01M15 10h.01"/>'),
  accommodation: svg('<path d="M3 18v-7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1h8a2 2 0 0 1 2 2v4"/><path d="M3 15h18M3 20v-2M21 20v-2"/>'),
  service: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'),
  food: svg('<path d="M5 9h12v4a6 6 0 0 1-12 0z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>'),
  sport: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 0 1 0 18M3.6 9h16.8M3.6 15h16.8"/>'),
  gym: svg('<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>'),
  entrance: svg('<path d="M4 21V9a8 8 0 0 1 16 0v12"/><path d="M8 21v-9M16 21v-9M12 21v-9"/>'),
  // place icons by kind (own line set, not the university map's symbols)
  academic: svg('<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3V11"/><path d="M21.5 9v5.5"/>'),
  library: svg('<path d="M12 6.5C10 5 7 4.5 4 5v13.5c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z"/><path d="M12 6.5V20"/>'),
  health: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/>'),
  union: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.3A4.5 4.5 0 0 1 21 19"/>'),
  faith: svg('<path d="M12 3c1.7 1.9 2.2 3.1 2.2 4.2a2.2 2.2 0 0 1-4.4 0C9.8 6.1 10.3 4.9 12 3z"/><rect x="8.5" y="11.5" width="7" height="9.5" rx="1.5"/>'),
  careers: svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>'),
  security: svg('<path d="M12 3 19 6v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  laundry: svg('<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="13" r="4.5"/><path d="M8 6.5h.01M11 6.5h4"/>'),
  cafe: svg('<path d="M5 9h12v4a6 6 0 0 1-12 0z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>'),
  restaurant: svg('<path d="M5 3v5a2 2 0 0 0 4 0V3M7 3v18"/><path d="M17 21V3c-2 1-3.5 3.5-3.5 7.5 0 1.4.9 2.5 2.2 2.5H17"/>'),
  bar: svg('<path d="M5 4h14l-7 8z"/><path d="M12 12v8M8 20h8"/>'),
  shop: svg('<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  map: svg('<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13M15 6.5v13"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  share: svg('<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
  directions: svg('<path d="M12 2.8 21.2 12 12 21.2 2.8 12z"/><path d="M9 14v-2.5a1.5 1.5 0 0 1 1.5-1.5H15M13 8l2 2-2 2"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  accessible: svg('<circle cx="12" cy="4.5" r="1.8"/><path d="M8 9h8M12 9v5h4l2 5"/><path d="M8.5 13a5 5 0 1 0 6.7 6.2"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  locate: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  compass: svg('<path d="M12 3 8 13h8z" fill="#ff6b8b" stroke="none"/><path d="M12 21l4-8H8z" fill="currentColor" stroke="none" opacity=".35"/>'),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="m9 21 3-7 3 3v4M7 12l3-4 4 1 2 4M12 14l-1-5"/>'),
  instagram: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>'),
  linkedin: svg('<path d="M4 9h3.5v11H4zM5.75 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9h3.4v1.6c.5-1 1.8-1.9 3.6-1.9 3.4 0 4 2.2 4 5.1V20h-3.5v-5.4c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V20H10z"/>', true),
};

const byKind: Record<string, string> = {
  academic: icons.academic, accommodation: icons.accommodation, library: icons.library, health: icons.health,
  union: icons.union, faith: icons.faith, careers: icons.careers, security: icons.security, laundry: icons.laundry,
  service: icons.service, cafe: icons.cafe, restaurant: icons.restaurant, bar: icons.bar, shop: icons.shop,
  gym: icons.gym, court: icons.sport, 'sports-hall': icons.sport, entrance: icons.entrance,
};

export function placeIcon(category: string, kind: string): string {
  return byKind[kind]
    ?? (category === 'food' ? icons.cafe
      : category === 'sport' ? icons.sport
      : category === 'entrance' ? icons.entrance
      : icons.building);
}
