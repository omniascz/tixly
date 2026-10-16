/**
 * Kategorie položek rozpočtu akce. Musí odpovídat CHECKu na
 * `catalog.event_costs.category` (migrace 473).
 *
 * Samostatný soubor, protože `route.ts` smí v Next exportovat jen handlery.
 */
export const COST_CATEGORIES = [
  'venue',
  'production',
  'staff',
  'artist',
  'marketing',
  'travel',
  'accommodation',
  'catering',
  'rights',
  'insurance',
  'security',
  'other',
] as const;
