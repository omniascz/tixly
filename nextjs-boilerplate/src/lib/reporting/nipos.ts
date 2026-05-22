/**
 * NIPOS reporting (Národní informační a poradenské středisko pro kulturu).
 *
 * NIPOS sbírá kulturní statistiky podle zákona 101/2001 Sb. Tixly poskytuje
 * promotérům výpočet statistik per quarter a per year, ke stažení jako CSV.
 *
 * Pole (NIPOS Kult 1-01 formulář pro divadlo + koncerty):
 *   - Počet odehraných představení (events.status='published' AND date < period_end)
 *   - Počet plánovaných představení (created_at v period range)
 *   - Návštěvníci celkem (tickets.tickets.status='valid' + used_at)
 *   - Návštěvníci platící (excluded promo, vouchers, free)
 *   - Příjem hrubý (orders.orders.total_amount paid v period)
 *   - Vrácené vstupenky (refund_requests v period)
 *   - Návštěvnost premiér vs reprízy (events.template != 'subscription')
 *
 * Aggregace per:
 *   - Promotér (default)
 *   - Venue (volitelně)
 *   - Kategorie (theatre/music/sport)
 */

export interface NiposReportRow {
  category: string;
  eventsPlanned: number;
  eventsHeld: number;
  visitorsTotal: number;
  visitorsPaying: number;
  grossRevenueHalire: number;
  refundedTickets: number;
  refundedRevenueHalire: number;
}

export interface NiposReportSummary {
  promoterId: string;
  promoterName: string;
  periodStart: string;
  periodEnd: string;
  totalEvents: number;
  totalVisitors: number;
  totalRevenueHalire: number;
  byCategory: NiposReportRow[];
}

export function summaryToCsv(s: NiposReportSummary): string {
  const lines: string[] = [];
  lines.push(`NIPOS Kult 1-01 — výkaz divadel a hudebních souborů`);
  lines.push(`Pořadatel: ${s.promoterName}`);
  lines.push(`Promotér ID: ${s.promoterId}`);
  lines.push(`Období: ${s.periodStart} až ${s.periodEnd}`);
  lines.push('');
  lines.push(
    [
      'Kategorie',
      'Plánováno',
      'Odehráno',
      'Návštěvníci celkem',
      'Platící',
      'Hrubý příjem (Kč)',
      'Vráceno (ks)',
      'Vráceno (Kč)',
    ].join(';'),
  );
  for (const r of s.byCategory) {
    lines.push(
      [
        r.category,
        r.eventsPlanned,
        r.eventsHeld,
        r.visitorsTotal,
        r.visitorsPaying,
        (r.grossRevenueHalire / 100).toFixed(2).replace('.', ','),
        r.refundedTickets,
        (r.refundedRevenueHalire / 100).toFixed(2).replace('.', ','),
      ].join(';'),
    );
  }
  lines.push('');
  lines.push(`Celkem akcí: ${s.totalEvents}`);
  lines.push(`Celkem návštěvníků: ${s.totalVisitors}`);
  lines.push(`Celkem hrubý příjem: ${(s.totalRevenueHalire / 100).toFixed(2).replace('.', ',')} Kč`);
  return lines.join('\n');
}
