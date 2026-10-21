import type { Day } from '../types';

/**
 * Opening hours: the one place they live. Each entry is one place for one period (term time,
 * vacation, a single week). Only add hours you have read yourself on an official source: the
 * university's own pages (roehampton.ac.uk, roehamptonstudent.com, roehampton.libcal.com), the
 * business's own website (e.g. lifestylefitness.co.uk for the gym), or a Nest screenshot.
 * Never hours from Google, an AI summary or any other unverified source, and never a guess.
 * A place with no entry shows no hours.
 *
 * weekly: a missing day = not listed; [] = closed all day; a range may run past midnight
 *   (["20:00", "02:00"]); ["00:00", "24:00"] = open all day.
 * from / to: the dates these hours apply to (both included). Leave `to` out when the source gives
 *   no end date: then only the 30-day rule below applies.
 * checked: the day you read them. Once it is more than 30 days ago, or `to` has passed, the card
 *   says "Hours may have changed" instead of "Open now".
 * unknown: what the card says on a day with no listed hours ("Check with the gym"). Such a day is
 *   never "Open now". An entry with an empty `weekly` says only this.
 */
export interface HoursEntry {
  place: string; // id in data/places.json
  period: string; // "Term time", "Vacation", "Week of 19 Oct 2026"
  from: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  weekly: Partial<Record<Day, [string, string][]>>;
  source?: { name: string; url: string }; // left out when there is no verified source at all
  checked: string; // YYYY-MM-DD
  notes?: string;
  unknown?: string;
}

const LIBCAL = { name: 'LibCal', url: 'https://roehampton.libcal.com/hours/' };
const WEEKDAYS = (open: string, close: string) => Object.fromEntries((['mon', 'tue', 'wed', 'thu', 'fri'] as const).map((d) => [d, [[open, close]]])) as HoursEntry['weekly'];
const EVERY_DAY = (open: string, close: string) => Object.fromEntries((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((d) => [d, [[open, close]]])) as HoursEntry['weekly'];

/**
 * Places whose hours are read live on the phone. The entries below are only the fallback for
 * when LibCal can't be reached (and nothing was saved from an earlier visit).
 */
export const LIVE: Record<string, { iid: number; lid: number; source: NonNullable<HoursEntry['source']> }> = {
  library: { iid: 4033, lid: 6082, source: LIBCAL },
};

export const HOURS: HoursEntry[] = [
  {
    place: 'library',
    period: 'Term time',
    from: '2026-10-21',
    weekly: { ...WEEKDAYS('08:00', '23:59'), sat: [['10:00', '16:00']], sun: [['10:00', '16:00']] },
    source: LIBCAL,
    checked: '2026-10-21',
    notes: "Term-time hours. Outside these times, the 24-hour study space is in Queen's Building.",
  },
  {
    place: 'elm-grove',
    period: 'All year',
    from: '2026-10-20',
    weekly: WEEKDAYS('09:00', '17:00'), // weekends not listed
    source: { name: 'Careers (roehampton.ac.uk)', url: 'https://www.roehampton.ac.uk/student-support/careers/' },
    checked: '2026-10-20',
    notes: 'When the Student Futures careers team can be contacted. Weekend hours are not listed.',
  },
  {
    place: 'campus-safety',
    period: 'All year',
    from: '2026-10-20',
    weekly: EVERY_DAY('00:00', '24:00'),
    source: { name: 'Wellbeing support (roehampton.ac.uk)', url: 'https://www.roehampton.ac.uk/student-support/non-academic-and-academic-support/wellbeing-support/' },
    checked: '2026-10-20',
    notes: 'The campus safety and security team works 24/7. Phone 020 8392 3333.',
  },
  {
    place: 'student-medical-centre',
    period: 'Term time',
    from: '2026-10-20',
    weekly: WEEKDAYS('09:30', '13:00'),
    source: { name: 'Student Medical Centre (roehampton.ac.uk)', url: 'https://www.roehampton.ac.uk/study/september-induction/student-medical-centre/' },
    checked: '2026-10-20',
    notes: 'Term time only. Outside these times and during the Easter, Christmas and summer breaks, patients are seen at Putneymead Group Medical Practice in Putney or online.',
  },
  {
    place: 'gym',
    period: 'All year',
    from: '2026-10-21',
    weekly: WEEKDAYS('06:00', '22:00'), // weekends not listed
    source: { name: 'Lifestyle Fitness', url: 'https://www.lifestylefitness.co.uk/club/roehampton' },
    checked: '2026-10-21',
    unknown: 'Check with the gym',
  },
  {
    place: 'union-bar',
    period: 'All year',
    from: '2026-10-21',
    weekly: { ...WEEKDAYS('17:00', '23:00'), sat: [], sun: [] },
    source: { name: "Students' Union", url: 'https://www.roehamptonstudent.com/' },
    checked: '2026-10-21',
    notes: 'Event nights may run later',
  },
  {
    place: 'hive-cafe',
    period: 'Term time',
    from: '2026-10-21',
    weekly: WEEKDAYS('08:00', '16:00'), // weekends not listed
    source: { name: 'The Hive (roehamptonstudent.com)', url: 'https://www.roehamptonstudent.com/hive/' },
    checked: '2026-10-21',
    notes: 'Term-time · summer hours shorter',
    unknown: 'Weekend hours not listed. Check before you go.',
  },
  // no verified hours: the card sends people to Nest
  ...['digby-den-diner', 'froebel-diner'].map((place): HoursEntry => ({
    place, period: 'All year', from: '2026-10-21', weekly: {}, checked: '2026-10-21', unknown: 'Hours: check on Nest',
  })),
];
