/**
 * Event templates — předdefinované scénáře, které promotér vybere v wizardu krok 1.
 *
 * Každý template určuje:
 *   - kolik dní generuje (default range)
 *   - jaké zóny předpokládá (Stage A/B, VIP, Camping…)
 *   - jaké ticket types předgeneruje (Standard, Day Pass, VIP)
 *   - jaké kroky wizardu skrýt/zobrazit
 *
 * Univerzální datový model dovoluje libovolnou kombinaci. Templates jen UI-fast-track
 * pro 90 % případů. Expert mode = vybrat 'custom' a postavit si vlastní matrix.
 */

export type TemplateId =
  | 'single_event'
  | 'multi_day_festival'
  | 'sport_season'
  | 'theatre_subscription'
  | 'conference'
  | 'open_air'
  | 'workshop_series'
  | 'online_stream';

export interface TicketTypeTemplate {
  name: string;
  priceCzk: number;
  capacity: number;
  /** Manifest přístupu — kterým dnům + zónám tento ticket vstupuje. */
  accessSpec: AccessSpec[];
  description?: string;
}

export interface AccessSpec {
  /** Index dne v `days` array (0-based), nebo 'all' pro wildcard. */
  dayIndex: number | 'all';
  /** Název zóny (musí matchnout zone.name), nebo 'all' pro všechny zóny. */
  zoneName: string | 'all';
  level: 'general' | 'premium' | 'vip' | 'backstage' | 'accessibility';
}

export interface ZoneTemplate {
  name: string;
  zoneType:
    | 'general'
    | 'stage'
    | 'vip'
    | 'premium'
    | 'backstage'
    | 'camping'
    | 'parking'
    | 'accessibility'
    | 'other';
  capacityHint?: number;
  description?: string;
}

export interface EventTemplate {
  id: TemplateId;
  label: string;
  description: string;
  icon: string;
  defaultCategory: string;
  defaultEventType: string;
  /** Predefined dni (pokud je promotér nezmění). */
  defaultDays: { label: string; offsetHours: number; durationHours: number }[];
  /** Predefined zóny. */
  defaultZones: ZoneTemplate[];
  /** Predefined ticket types s manifest. */
  defaultTicketTypes: TicketTypeTemplate[];
  /** Volitelné — kroky, které wizard zviditelní (pro různé templates různé). */
  steps: WizardStep[];
}

export type WizardStep =
  | 'basics'
  | 'datetime_venue'
  | 'days_zones'
  | 'tickets_access'
  | 'addons'
  | 'marketing'
  | 'rules'
  | 'review';

const COMMON_STEPS: WizardStep[] = [
  'basics',
  'datetime_venue',
  'tickets_access',
  'marketing',
  'rules',
  'review',
];

const FESTIVAL_STEPS: WizardStep[] = [
  'basics',
  'datetime_venue',
  'days_zones',
  'tickets_access',
  'addons',
  'marketing',
  'rules',
  'review',
];

export const EVENT_TEMPLATES: Record<TemplateId, EventTemplate> = {
  single_event: {
    id: 'single_event',
    label: 'Klubový koncert / Single event',
    description:
      'Jednorázový koncert nebo show. 1 datum, 1 místo, klasické typy (Standard, VIP).',
    icon: '🎤',
    defaultCategory: 'concert',
    defaultEventType: 'concert',
    defaultDays: [{ label: 'Hlavní termín', offsetHours: 0, durationHours: 4 }],
    defaultZones: [
      { name: 'Hlavní sál', zoneType: 'general' },
    ],
    defaultTicketTypes: [
      {
        name: 'Standard',
        priceCzk: 500,
        capacity: 200,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'general' }],
      },
      {
        name: 'VIP (lepší výhled + drink)',
        priceCzk: 1200,
        capacity: 30,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'vip' }],
      },
    ],
    steps: COMMON_STEPS,
  },

  multi_day_festival: {
    id: 'multi_day_festival',
    label: 'Hudební festival (vícedenní)',
    description:
      'Po sobě jdoucí dni, několik scén, kombinace day pass / full festival pass / VIP. Camping a parking jako add-on.',
    icon: '🎪',
    defaultCategory: 'festival',
    defaultEventType: 'festival',
    defaultDays: [
      { label: 'Pátek', offsetHours: 0, durationHours: 8 },
      { label: 'Sobota', offsetHours: 24, durationHours: 12 },
      { label: 'Neděle', offsetHours: 48, durationHours: 8 },
    ],
    defaultZones: [
      { name: 'Stage A (hlavní)', zoneType: 'stage', capacityHint: 5000 },
      { name: 'Stage B', zoneType: 'stage', capacityHint: 2000 },
      { name: 'VIP Lounge', zoneType: 'vip', capacityHint: 200 },
      { name: 'Camping', zoneType: 'camping', capacityHint: 1000 },
      { name: 'Parking', zoneType: 'parking', capacityHint: 500 },
    ],
    defaultTicketTypes: [
      {
        name: 'Full Festival Pass',
        priceCzk: 2500,
        capacity: 3000,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'general' }],
        description: 'Všechny dny + všechny scény (kromě VIP/camping/parking).',
      },
      {
        name: 'Day Pass — Pátek',
        priceCzk: 800,
        capacity: 1000,
        accessSpec: [{ dayIndex: 0, zoneName: 'all', level: 'general' }],
      },
      {
        name: 'Day Pass — Sobota',
        priceCzk: 1200,
        capacity: 1500,
        accessSpec: [{ dayIndex: 1, zoneName: 'all', level: 'general' }],
      },
      {
        name: 'Day Pass — Neděle',
        priceCzk: 800,
        capacity: 800,
        accessSpec: [{ dayIndex: 2, zoneName: 'all', level: 'general' }],
      },
      {
        name: 'Full Festival VIP',
        priceCzk: 5000,
        capacity: 200,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'vip' }],
        description: 'Vše + VIP Lounge přístup.',
      },
    ],
    steps: FESTIVAL_STEPS,
  },

  sport_season: {
    id: 'sport_season',
    label: 'Sportovní permanentka (sezóna)',
    description:
      'Permanentka na sezónu — všechny domácí zápasy. Promotér přidá zápasy postupně po losu rozlosování. Sektory (sever, jih, VIP).',
    icon: '⚽',
    defaultCategory: 'sports',
    defaultEventType: 'sport',
    defaultDays: [
      { label: '1. zápas (přidáš termín)', offsetHours: 0, durationHours: 3 },
    ],
    defaultZones: [
      { name: 'Sektor A (sever)', zoneType: 'general', capacityHint: 5000 },
      { name: 'Sektor B (jih)', zoneType: 'general', capacityHint: 5000 },
      { name: 'Sektor C (VIP business)', zoneType: 'vip', capacityHint: 300 },
      { name: 'Bezbariérová zóna', zoneType: 'accessibility', capacityHint: 50 },
    ],
    defaultTicketTypes: [
      {
        name: 'Sezónní permanentka — Sektor A',
        priceCzk: 6000,
        capacity: 3000,
        accessSpec: [{ dayIndex: 'all', zoneName: 'Sektor A (sever)', level: 'general' }],
      },
      {
        name: 'Sezónní permanentka — Sektor B',
        priceCzk: 6000,
        capacity: 3000,
        accessSpec: [{ dayIndex: 'all', zoneName: 'Sektor B (jih)', level: 'general' }],
      },
      {
        name: 'Sezónní permanentka — VIP Business',
        priceCzk: 25000,
        capacity: 200,
        accessSpec: [{ dayIndex: 'all', zoneName: 'Sektor C (VIP business)', level: 'vip' }],
      },
    ],
    steps: FESTIVAL_STEPS,
  },

  theatre_subscription: {
    id: 'theatre_subscription',
    label: 'Divadelní abonentka',
    description:
      'Sezónní abonentka — vyber N představení z M. Reservované sezení v sektoru. Klasický flex pass.',
    icon: '🎭',
    defaultCategory: 'theatre',
    defaultEventType: 'theatre',
    defaultDays: [
      { label: 'Představení 1 (přidáš termíny)', offsetHours: 0, durationHours: 3 },
    ],
    defaultZones: [
      { name: 'Hlediště — parket', zoneType: 'general' },
      { name: 'Hlediště — balkón', zoneType: 'general' },
      { name: 'Lóže', zoneType: 'premium' },
    ],
    defaultTicketTypes: [
      {
        name: 'Abonentka — 6 představení (parket)',
        priceCzk: 3000,
        capacity: 200,
        accessSpec: [{ dayIndex: 'all', zoneName: 'Hlediště — parket', level: 'general' }],
        description: 'Vyber si 6 z 12 představení sezóny.',
      },
      {
        name: 'Abonentka — 6 představení (balkón)',
        priceCzk: 2200,
        capacity: 300,
        accessSpec: [{ dayIndex: 'all', zoneName: 'Hlediště — balkón', level: 'general' }],
      },
    ],
    steps: FESTIVAL_STEPS,
  },

  conference: {
    id: 'conference',
    label: 'Konference / Workshop',
    description:
      'Multi-day konference s parallel tracky. Networking event večer, workshopy s limit kapacitou.',
    icon: '🎓',
    defaultCategory: 'conference',
    defaultEventType: 'conference',
    defaultDays: [
      { label: 'Den 1', offsetHours: 0, durationHours: 8 },
      { label: 'Den 2', offsetHours: 24, durationHours: 8 },
    ],
    defaultZones: [
      { name: 'Hlavní sál (keynotes)', zoneType: 'general', capacityHint: 500 },
      { name: 'Track A (workshopy)', zoneType: 'general', capacityHint: 50 },
      { name: 'Track B (workshopy)', zoneType: 'general', capacityHint: 50 },
      { name: 'Networking lounge', zoneType: 'premium', capacityHint: 100 },
    ],
    defaultTicketTypes: [
      {
        name: 'Standard pass (oba dny)',
        priceCzk: 4500,
        capacity: 300,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'general' }],
      },
      {
        name: 'VIP pass + Networking',
        priceCzk: 8500,
        capacity: 50,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'premium' }],
      },
    ],
    steps: FESTIVAL_STEPS,
  },

  open_air: {
    id: 'open_air',
    label: 'Open-air akce',
    description:
      'Venkovní akce, jeden den, jeden areál. Bez sektorů — jen GA + VIP.',
    icon: '☀️',
    defaultCategory: 'festival',
    defaultEventType: 'festival',
    defaultDays: [{ label: 'Akce', offsetHours: 0, durationHours: 8 }],
    defaultZones: [
      { name: 'Areál', zoneType: 'general' },
      { name: 'VIP Lounge', zoneType: 'vip' },
    ],
    defaultTicketTypes: [
      {
        name: 'GA',
        priceCzk: 600,
        capacity: 2000,
        accessSpec: [{ dayIndex: 'all', zoneName: 'Areál', level: 'general' }],
      },
      {
        name: 'VIP',
        priceCzk: 1500,
        capacity: 200,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'vip' }],
      },
    ],
    steps: COMMON_STEPS,
  },

  workshop_series: {
    id: 'workshop_series',
    label: 'Workshop série / Kurz',
    description:
      'Opakující se kurz (např. 8 lekcí jógy každý čtvrtek). Block bundle na celý kurz.',
    icon: '🧘',
    defaultCategory: 'workshop',
    defaultEventType: 'workshop',
    defaultDays: [
      { label: 'Lekce 1', offsetHours: 0, durationHours: 1.5 },
      { label: 'Lekce 2', offsetHours: 168, durationHours: 1.5 },
      { label: 'Lekce 3', offsetHours: 336, durationHours: 1.5 },
      { label: 'Lekce 4', offsetHours: 504, durationHours: 1.5 },
    ],
    defaultZones: [{ name: 'Studio', zoneType: 'general' }],
    defaultTicketTypes: [
      {
        name: 'Celý kurz (4 lekce)',
        priceCzk: 1600,
        capacity: 20,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'general' }],
      },
      {
        name: 'Jednorázový vstup',
        priceCzk: 500,
        capacity: 5,
        accessSpec: [{ dayIndex: 0, zoneName: 'all', level: 'general' }],
        description: 'Vyber si kteroukoli lekci (kupec při vstupu uplatní).',
      },
    ],
    steps: FESTIVAL_STEPS,
  },

  online_stream: {
    id: 'online_stream',
    label: 'Online stream',
    description:
      'Virtuální event — bez fyzického místa. Geo-block, replay window, max concurrent viewers.',
    icon: '💻',
    defaultCategory: 'other',
    defaultEventType: 'online',
    defaultDays: [{ label: 'Live stream', offsetHours: 0, durationHours: 2 }],
    defaultZones: [{ name: 'Stream', zoneType: 'general' }],
    defaultTicketTypes: [
      {
        name: 'Live + Replay',
        priceCzk: 300,
        capacity: 10000,
        accessSpec: [{ dayIndex: 'all', zoneName: 'all', level: 'general' }],
      },
    ],
    steps: COMMON_STEPS,
  },
};

export const TEMPLATE_LIST: EventTemplate[] = Object.values(EVENT_TEMPLATES);
