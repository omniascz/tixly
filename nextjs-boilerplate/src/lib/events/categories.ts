/**
 * Event category taxonomie — TOP druh × SUB žánr × Format formát.
 *
 * Struktura:
 *   - `category` (TOP, povinné):  music | theatre | comedy | sport | conference |
 *     family | club | gastro | exhibition | education | other
 *   - `subcategory` (SUB, povinné v UI, NULL pro legacy):  konkrétní žánr per category
 *   - `event_type` (Format):  physical | online | hybrid (orthogonální)
 *
 * Pravidla:
 *   - Kupec vidí TOP filter chips na /cs/events (Hudba / Divadlo / Sport / ...)
 *   - Klik TOP → zobrazí SUB filter (Koncert klubový / Festival vícedenní / DJ Set / ...)
 *   - Format je vlastní filter "Online", "Hybrid"
 *
 * Backward compat:
 *   - Migrace 287: ADD COLUMN subcategory (nullable)
 *   - Old eventy nemají subcategory → zobrazí se jako "ostatní žánry"
 */

export interface SubCategory {
  /** Stable identifier (v DB). */
  id: string;
  /** Český label viditelný v UI. */
  label: string;
  /** Anglický label pro SEO + EN buyer. */
  labelEn: string;
  /** Slovenský label. */
  labelSk: string;
}

export interface TopCategory {
  /** Stable id v DB (catalog.events.category). */
  id: string;
  /** Emoji icon pro UI chips. */
  icon: string;
  /** Český label. */
  label: string;
  /** Anglický label. */
  labelEn: string;
  /** Slovenský label. */
  labelSk: string;
  /** Seznam podkategorií. */
  subcategories: SubCategory[];
}

export const TOP_CATEGORIES: TopCategory[] = [
  {
    id: 'music',
    icon: '🎵',
    label: 'Hudba',
    labelEn: 'Music',
    labelSk: 'Hudba',
    subcategories: [
      { id: 'concert_club',      label: 'Koncert klubový',       labelEn: 'Club concert',         labelSk: 'Klubový koncert' },
      { id: 'concert_hall',      label: 'Koncert halový',        labelEn: 'Hall concert',         labelSk: 'Halový koncert' },
      { id: 'concert_arena',     label: 'Koncert arénový',       labelEn: 'Arena concert',        labelSk: 'Arénový koncert' },
      { id: 'festival_one_day',  label: 'Festival (1 den)',      labelEn: 'One-day festival',     labelSk: 'Festival (1 deň)' },
      { id: 'festival_multi',    label: 'Festival vícedenní',    labelEn: 'Multi-day festival',   labelSk: 'Festival viacdenný' },
      { id: 'open_air',          label: 'Open-air',              labelEn: 'Open-air',             labelSk: 'Open-air' },
      { id: 'dj_set',            label: 'DJ set',                labelEn: 'DJ set',               labelSk: 'DJ set' },
      { id: 'acoustic',          label: 'Akustická show',        labelEn: 'Acoustic show',        labelSk: 'Akustická show' },
      { id: 'album_release',     label: 'Křest desky',           labelEn: 'Album release',        labelSk: 'Krst albumu' },
      { id: 'tribute',           label: 'Tribute show',          labelEn: 'Tribute show',         labelSk: 'Tribute show' },
      { id: 'orchestra',         label: 'Orchestr / klasika',    labelEn: 'Orchestra / classical', labelSk: 'Orchester / klasika' },
      { id: 'music_other',       label: 'Hudba — jiné',          labelEn: 'Music — other',        labelSk: 'Hudba — iné' },
    ],
  },
  {
    id: 'theatre',
    icon: '🎭',
    label: 'Divadlo',
    labelEn: 'Theatre',
    labelSk: 'Divadlo',
    subcategories: [
      { id: 'play',              label: 'Činohra',               labelEn: 'Drama',                labelSk: 'Činohra' },
      { id: 'opera',             label: 'Opera',                 labelEn: 'Opera',                labelSk: 'Opera' },
      { id: 'ballet',            label: 'Balet',                 labelEn: 'Ballet',               labelSk: 'Balet' },
      { id: 'musical',           label: 'Muzikál',               labelEn: 'Musical',              labelSk: 'Muzikál' },
      { id: 'puppet',            label: 'Loutkové divadlo',      labelEn: 'Puppet theatre',       labelSk: 'Bábkové divadlo' },
      { id: 'improv',            label: 'Improvizace',           labelEn: 'Improvisation',        labelSk: 'Improvizácia' },
      { id: 'fairy_tale',        label: 'Pohádka',               labelEn: 'Fairy tale',           labelSk: 'Rozprávka' },
      { id: 'theatre_other',     label: 'Divadlo — jiné',        labelEn: 'Theatre — other',      labelSk: 'Divadlo — iné' },
    ],
  },
  {
    id: 'comedy',
    icon: '🎤',
    label: 'Komedie',
    labelEn: 'Comedy',
    labelSk: 'Komédia',
    subcategories: [
      { id: 'standup',           label: 'Stand-up',              labelEn: 'Stand-up',             labelSk: 'Stand-up' },
      { id: 'improshow',         label: 'Improshow',             labelEn: 'Improv show',          labelSk: 'Improshow' },
      { id: 'sketch',            label: 'Sketch / Skupina',      labelEn: 'Sketch / Group',       labelSk: 'Skeč / Skupina' },
      { id: 'comedy_show',       label: 'Komediální pořad',      labelEn: 'Comedy show',          labelSk: 'Komediálna show' },
      { id: 'roast',             label: 'Roast',                 labelEn: 'Roast',                labelSk: 'Roast' },
      { id: 'comedy_other',      label: 'Komedie — jiné',        labelEn: 'Comedy — other',       labelSk: 'Komédia — iné' },
    ],
  },
  {
    id: 'sport',
    icon: '⚽',
    label: 'Sport',
    labelEn: 'Sport',
    labelSk: 'Šport',
    subcategories: [
      { id: 'hockey',            label: 'Hokej',                 labelEn: 'Ice hockey',           labelSk: 'Hokej' },
      { id: 'football',          label: 'Fotbal',                labelEn: 'Football',             labelSk: 'Futbal' },
      { id: 'basketball',        label: 'Basketball',            labelEn: 'Basketball',           labelSk: 'Basketbal' },
      { id: 'tennis',            label: 'Tenis',                 labelEn: 'Tennis',               labelSk: 'Tenis' },
      { id: 'mma',               label: 'MMA / Box',             labelEn: 'MMA / Boxing',         labelSk: 'MMA / Box' },
      { id: 'esport',            label: 'eSport',                labelEn: 'eSport',               labelSk: 'eSport' },
      { id: 'athletics',         label: 'Atletika',              labelEn: 'Athletics',            labelSk: 'Atletika' },
      { id: 'volleyball',        label: 'Volejbal',              labelEn: 'Volleyball',           labelSk: 'Volejbal' },
      { id: 'handball',          label: 'Házená',                labelEn: 'Handball',             labelSk: 'Hádzaná' },
      { id: 'motorsport',        label: 'Motorsport',            labelEn: 'Motorsport',           labelSk: 'Motorsport' },
      { id: 'sport_other',       label: 'Sport — jiné',          labelEn: 'Sport — other',        labelSk: 'Šport — iné' },
    ],
  },
  {
    id: 'conference',
    icon: '💼',
    label: 'Konference & Business',
    labelEn: 'Conference & Business',
    labelSk: 'Konferencia & Business',
    subcategories: [
      { id: 'b2b_conference',    label: 'B2B konference',        labelEn: 'B2B conference',       labelSk: 'B2B konferencia' },
      { id: 'tech_meetup',       label: 'Tech meetup',           labelEn: 'Tech meetup',          labelSk: 'Tech meetup' },
      { id: 'workshop_pro',      label: 'Workshop / školení',    labelEn: 'Workshop / training',  labelSk: 'Workshop / školenie' },
      { id: 'webinar',           label: 'Webinář',               labelEn: 'Webinar',              labelSk: 'Webinár' },
      { id: 'networking',        label: 'Networking',            labelEn: 'Networking',           labelSk: 'Networking' },
      { id: 'lecture_pro',       label: 'Odborná přednáška',     labelEn: 'Professional lecture', labelSk: 'Odborná prednáška' },
      { id: 'conference_other',  label: 'Konference — jiné',     labelEn: 'Conference — other',   labelSk: 'Konferencia — iné' },
    ],
  },
  {
    id: 'family',
    icon: '👨‍👩‍👧',
    label: 'Rodina & Děti',
    labelEn: 'Family & Kids',
    labelSk: 'Rodina & Deti',
    subcategories: [
      { id: 'kids_show',         label: 'Dětská show',           labelEn: 'Kids show',            labelSk: 'Detská show' },
      { id: 'kids_fairy_tale',   label: 'Pohádka pro děti',      labelEn: 'Kids fairy tale',      labelSk: 'Rozprávka pre deti' },
      { id: 'circus',            label: 'Cirkus',                labelEn: 'Circus',               labelSk: 'Cirkus' },
      { id: 'educational_kids',  label: 'Vzdělávací (pro děti)', labelEn: 'Educational (kids)',   labelSk: 'Vzdelávacie (pre deti)' },
      { id: 'school_perform',    label: 'Vystoupení škol',       labelEn: 'School performance',   labelSk: 'Vystúpenie škôl' },
      { id: 'family_other',      label: 'Rodina — jiné',         labelEn: 'Family — other',       labelSk: 'Rodina — iné' },
    ],
  },
  {
    id: 'club',
    icon: '🪩',
    label: 'Klub & Party',
    labelEn: 'Club & Party',
    labelSk: 'Klub & Party',
    subcategories: [
      { id: 'club_party',        label: 'Klubová party',         labelEn: 'Club party',           labelSk: 'Klubová party' },
      { id: 'themed_party',      label: 'Tematická párty',       labelEn: 'Themed party',         labelSk: 'Tematická párty' },
      { id: 'electronic',        label: 'Elektronická',          labelEn: 'Electronic',           labelSk: 'Elektronická' },
      { id: 'drumnbass',         label: "Drum'n'bass",           labelEn: "Drum'n'bass",          labelSk: "Drum'n'bass" },
      { id: 'techno',            label: 'Techno',                labelEn: 'Techno',               labelSk: 'Techno' },
      { id: 'house',             label: 'House',                 labelEn: 'House',                labelSk: 'House' },
      { id: 'disco',             label: 'Disco / Retro',         labelEn: 'Disco / Retro',        labelSk: 'Disco / Retro' },
      { id: 'club_other',        label: 'Klub — jiné',           labelEn: 'Club — other',         labelSk: 'Klub — iné' },
    ],
  },
  {
    id: 'gastro',
    icon: '🍷',
    label: 'Gastro & Lifestyle',
    labelEn: 'Food & Lifestyle',
    labelSk: 'Gastro & Lifestyle',
    subcategories: [
      { id: 'wine_tasting',      label: 'Degustace vína',        labelEn: 'Wine tasting',         labelSk: 'Degustácia vína' },
      { id: 'beer_tasting',      label: 'Degustace piva',        labelEn: 'Beer tasting',         labelSk: 'Degustácia piva' },
      { id: 'cooking_show',      label: 'Kulinářská show',       labelEn: 'Cooking show',         labelSk: 'Kulinárska show' },
      { id: 'food_festival',     label: 'Food festival',         labelEn: 'Food festival',        labelSk: 'Food festival' },
      { id: 'gastro_other',      label: 'Gastro — jiné',         labelEn: 'Food — other',         labelSk: 'Gastro — iné' },
    ],
  },
  {
    id: 'exhibition',
    icon: '🎨',
    label: 'Výstava & Kultura',
    labelEn: 'Exhibition & Culture',
    labelSk: 'Výstava & Kultúra',
    subcategories: [
      { id: 'gallery',           label: 'Galerie',               labelEn: 'Gallery',              labelSk: 'Galéria' },
      { id: 'museum',            label: 'Muzeum',                labelEn: 'Museum',               labelSk: 'Múzeum' },
      { id: 'vernissage',        label: 'Vernisáž',              labelEn: 'Vernissage',           labelSk: 'Vernisáž' },
      { id: 'film_screening',    label: 'Filmové promítání',     labelEn: 'Film screening',       labelSk: 'Filmová projekcia' },
      { id: 'art_workshop',      label: 'Umělecký workshop',     labelEn: 'Art workshop',         labelSk: 'Umelecký workshop' },
      { id: 'exhibition_other',  label: 'Výstava — jiné',        labelEn: 'Exhibition — other',   labelSk: 'Výstava — iné' },
    ],
  },
  {
    id: 'education',
    icon: '🎓',
    label: 'Vzdělávání',
    labelEn: 'Education',
    labelSk: 'Vzdelávanie',
    subcategories: [
      { id: 'lecture',           label: 'Přednáška',             labelEn: 'Lecture',              labelSk: 'Prednáška' },
      { id: 'course',            label: 'Kurz / Course',         labelEn: 'Course',               labelSk: 'Kurz' },
      { id: 'edu_workshop',      label: 'Vzdělávací workshop',   labelEn: 'Educational workshop', labelSk: 'Vzdelávací workshop' },
      { id: 'language_course',   label: 'Jazykový kurz',         labelEn: 'Language course',      labelSk: 'Jazykový kurz' },
      { id: 'edu_other',         label: 'Vzdělávání — jiné',     labelEn: 'Education — other',    labelSk: 'Vzdelávanie — iné' },
    ],
  },
  {
    id: 'other',
    icon: '🎫',
    label: 'Ostatní',
    labelEn: 'Other',
    labelSk: 'Ostatné',
    subcategories: [
      { id: 'private_event',     label: 'Soukromá akce',         labelEn: 'Private event',        labelSk: 'Súkromná akcia' },
      { id: 'charity',           label: 'Charita',               labelEn: 'Charity',              labelSk: 'Charita' },
      { id: 'religious',         label: 'Náboženská',            labelEn: 'Religious',            labelSk: 'Náboženská' },
      { id: 'community',         label: 'Komunitní',             labelEn: 'Community',            labelSk: 'Komunitná' },
      { id: 'other_other',       label: 'Jiné',                  labelEn: 'Other',                labelSk: 'Iné' },
    ],
  },
];

/** Lookup table TOP id → TopCategory. */
export const TOP_CATEGORY_MAP: Record<string, TopCategory> = Object.fromEntries(
  TOP_CATEGORIES.map((t) => [t.id, t]),
);

/** Lookup table SUB id → SubCategory + parent ID. */
export const SUB_CATEGORY_MAP: Record<string, SubCategory & { parentId: string }> =
  Object.fromEntries(
    TOP_CATEGORIES.flatMap((t) =>
      t.subcategories.map((s) => [s.id, { ...s, parentId: t.id }]),
    ),
  );

/** Format = orthogonální dimenze (kde se akce odehrává). */
export const FORMATS = [
  { id: 'physical', label: 'Klasická akce ve venue',  labelEn: 'Physical venue',  labelSk: 'Klasická akcia vo venue' },
  { id: 'online',   label: 'Online (streamovaná)',    labelEn: 'Online streaming', labelSk: 'Online (streamovaná)' },
  { id: 'hybrid',   label: 'Hybrid (physical + stream)', labelEn: 'Hybrid (physical + stream)', labelSk: 'Hybrid (physical + stream)' },
] as const;

export type FormatId = (typeof FORMATS)[number]['id'];

/** Helper: získat lokalizovaný label TOP kategorie. */
export function getTopLabel(id: string, locale: 'cs' | 'sk' | 'en' = 'cs'): string {
  const top = TOP_CATEGORY_MAP[id];
  if (!top) return id;
  return locale === 'sk' ? top.labelSk : locale === 'en' ? top.labelEn : top.label;
}

/** Helper: získat lokalizovaný label SUB kategorie. */
export function getSubLabel(id: string, locale: 'cs' | 'sk' | 'en' = 'cs'): string {
  const sub = SUB_CATEGORY_MAP[id];
  if (!sub) return id;
  return locale === 'sk' ? sub.labelSk : locale === 'en' ? sub.labelEn : sub.label;
}

/** Helper: získat lokalizovaný label formátu. */
export function getFormatLabel(id: string, locale: 'cs' | 'sk' | 'en' = 'cs'): string {
  const f = FORMATS.find((x) => x.id === id);
  if (!f) return id;
  return locale === 'sk' ? f.labelSk : locale === 'en' ? f.labelEn : f.label;
}

/** Validace: kombinace TOP+SUB musí být konzistentní. */
export function isValidCategoryPair(category: string, subcategory: string | null): boolean {
  if (!subcategory) return true; // backward compat — old events mohou mít NULL
  const sub = SUB_CATEGORY_MAP[subcategory];
  if (!sub) return false;
  return sub.parentId === category;
}
