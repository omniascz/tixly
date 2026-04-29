/**
 * Performance heuristics pro velké seating charts.
 * Camp Nou ~ 99k seats, Wembley ~ 90k, MetLife ~ 82k.
 */

export interface PerfHint {
  level: 'ok' | 'caution' | 'warning' | 'critical';
  message: string;
  recommendations: string[];
}

export function classifyChartSize(totalSeats: number): PerfHint {
  if (totalSeats < 5_000) {
    return {
      level: 'ok',
      message: `${totalSeats.toLocaleString('cs-CZ')} seats — žádné performance problémy.`,
      recommendations: [],
    };
  }
  if (totalSeats < 20_000) {
    return {
      level: 'caution',
      message: `${totalSeats.toLocaleString('cs-CZ')} seats — střední velikost.`,
      recommendations: [
        'Editor zvládá v pohodě, ale buyer-facing render má 200+ ms first paint.',
      ],
    };
  }
  if (totalSeats < 60_000) {
    return {
      level: 'warning',
      message: `${totalSeats.toLocaleString('cs-CZ')} seats — velký stadion.`,
      recommendations: [
        'Buyer-facing rendering by měl použít sector-first navigation (klikni na sektor → načti jeho seats).',
        'Zvaž progressive enhancement: nejdřív sector overview, lazy-load seats po kliknutí.',
        'Visual editor doporučuje preview-only mode (jen reprezentanti seats).',
      ],
    };
  }
  return {
    level: 'critical',
    message: `${totalSeats.toLocaleString('cs-CZ')} seats — mega stadion (Camp Nou class).`,
    recommendations: [
      'Plný SVG render JE BLOCKER pro 95th percentile mobile devices — vyžaduj sector-first flow.',
      'Event seat instantiation vyžaduje UNNEST batch insert (1 round-trip per sector).',
      'Buyer endpoint MUSÍ vracet jen relevant sektor (filter ?sector=…).',
      'Zvaž canvas/WebGL rendering místo SVG (200k DOM uzlů = paint storm).',
    ],
  };
}
