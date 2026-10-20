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
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  locate: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  compass: svg('<path d="M12 3 8 13h8z" fill="#ff6b8b" stroke="none"/><path d="M12 21l4-8H8z" fill="currentColor" stroke="none" opacity=".35"/>'),
  walk: svg('<circle cx="13" cy="4" r="2"/><path d="m9 21 3-7 3 3v4M7 12l3-4 4 1 2 4M12 14l-1-5"/>'),
  instagram: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>'),
  linkedin: svg('<path d="M4 9h3.5v11H4zM5.75 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9h3.4v1.6c.5-1 1.8-1.9 3.6-1.9 3.4 0 4 2.2 4 5.1V20h-3.5v-5.4c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V20H10z"/>', true),
};

export function placeIcon(category: string, kind: string): string {
  if (category === 'food') return icons.food;
  if (category === 'entrance') return icons.entrance;
  if (category === 'sport') return kind === 'gym' ? icons.gym : icons.sport;
  if (kind === 'accommodation') return icons.accommodation;
  if (kind === 'service') return icons.service;
  return icons.building;
}
