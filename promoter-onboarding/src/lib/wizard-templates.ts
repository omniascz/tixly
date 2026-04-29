export type WizardTemplate =
  | 'concert'
  | 'club_night'
  | 'festival'
  | 'conference'
  | 'sports'
  | 'theatre'
  | 'other';

export interface WizardTemplateDefaults {
  name: string;              // placeholder event name
  description: string;       // placeholder description
  defaultDurationMinutes: number;
  suggestedTicketTypes: Array<{
    name: string;
    priceHalire: number;     // INTEGER halíře (1 Kč = 100 halířů)
    capacity: number;
  }>;
}

export const WIZARD_TEMPLATES: Record<WizardTemplate, WizardTemplateDefaults> = {
  concert: {
    name: 'Můj koncert',
    description: 'Živé vystoupení vaší oblíbené kapely nebo umělce. Nezapomenutelný večer plný hudby.',
    defaultDurationMinutes: 120,
    suggestedTicketTypes: [
      { name: 'Vstupné', priceHalire: 49000, capacity: 400 },
      { name: 'VIP vstupné', priceHalire: 99000, capacity: 50 },
    ],
  },

  club_night: {
    name: 'Klubová noc',
    description: 'Večerní párty s nejlepšími DJ sety. Tanec, hudba a skvělá atmosféra až do rána.',
    defaultDurationMinutes: 360,
    suggestedTicketTypes: [
      { name: 'Předprodej', priceHalire: 19900, capacity: 300 },
      { name: 'Na místě', priceHalire: 29900, capacity: 100 },
    ],
  },

  festival: {
    name: 'Můj festival',
    description: 'Vícedenní hudební nebo kulturní festival s bohatým programem a mnoha účinkujícími.',
    defaultDurationMinutes: 480,
    suggestedTicketTypes: [
      { name: 'Jednodenní vstup', priceHalire: 79000, capacity: 1000 },
      { name: 'Víkendový pass', priceHalire: 149000, capacity: 500 },
      { name: 'VIP pass', priceHalire: 299000, capacity: 100 },
    ],
  },

  conference: {
    name: 'Moje konference',
    description:
      'Odborná konference s přednáškami, workshopy a networkingem. Setkání profesionálů z oboru.',
    defaultDurationMinutes: 480,
    suggestedTicketTypes: [
      { name: 'Regular', priceHalire: 150000, capacity: 200 },
      { name: 'VIP', priceHalire: 350000, capacity: 30 },
    ],
  },

  sports: {
    name: 'Sportovní akce',
    description: 'Vzrušující sportovní utkání nebo turnaj. Přijďte fandit a zažít atmosféru velkého sportu.',
    defaultDurationMinutes: 150,
    suggestedTicketTypes: [
      { name: 'Tribuna A', priceHalire: 25000, capacity: 500 },
      { name: 'Tribuna B', priceHalire: 15000, capacity: 800 },
      { name: 'VIP box', priceHalire: 120000, capacity: 40 },
    ],
  },

  theatre: {
    name: 'Divadelní představení',
    description: 'Umělecké divadelní představení plné emocí a příběhů, které vás nenechají klidnými.',
    defaultDurationMinutes: 100,
    suggestedTicketTypes: [
      { name: 'Standardní místo', priceHalire: 35000, capacity: 150 },
      { name: 'Preferované místo', priceHalire: 55000, capacity: 50 },
    ],
  },

  other: {
    name: 'Moje akce',
    description: 'Popis vaší akce. Řekněte návštěvníkům, co je čeká a proč by neměli chybět.',
    defaultDurationMinutes: 120,
    suggestedTicketTypes: [
      { name: 'Vstupné', priceHalire: 20000, capacity: 100 },
    ],
  },
};
