/**
 * Kolo 8 / krok 1 — veřejná data inscenací a programu (sdílí API i stránky).
 * Jen publikované budoucí termíny. Obsazenost = prodaná / všechna sedadla termínu (u sedadlových termínů),
 * jinak prodané / celková kapacita typů vstupenek.
 */
import { PRODUCTION_COLUMNS, toProductionCard, type ProductionCard, type ProductionRow } from './production-card';

interface Q {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface PublicTerm {
  eventId: string; slug: string | null; dateStart: string; city: string; venueName: string; termNote: string | null;
  castAlternation: string | null; capacity: number; sold: number; occupancyPct: number; salesOpen: boolean;
}

const TERM_SELECT = `
  e.id AS "eventId", e.slug, e.date_start AS "dateStart", COALESCE(v.city, '') AS city, COALESCE(v.name, '') AS "venueName",
  e.term_note AS "termNote", e.cast_alternation AS "castAlternation",
  COALESCE(NULLIF((SELECT count(*) FROM catalog.event_seats s WHERE s.event_id = e.id), 0),
           (SELECT COALESCE(sum(total_qty), 0) FROM catalog.ticket_types t WHERE t.event_id = e.id))::int AS capacity,
  CASE WHEN EXISTS (SELECT 1 FROM catalog.event_seats s WHERE s.event_id = e.id)
       THEN (SELECT count(*) FROM catalog.event_seats s WHERE s.event_id = e.id AND s.status = 'sold')
       ELSE (SELECT COALESCE(sum(total_qty - remaining_qty), 0) FROM catalog.ticket_types t WHERE t.event_id = e.id) END::int AS sold,
  (COALESCE(e.sales_end_at, e.date_start) > now()) AS "salesOpen"`;

const withPct = <T extends { capacity: number; sold: number }>(t: T) =>
  ({ ...t, occupancyPct: t.capacity > 0 ? Math.round((t.sold / t.capacity) * 100) : 0 });

export async function loadPublicProduction(q: Q, id: string): Promise<{ production: ProductionCard; terms: PublicTerm[] } | null> {
  const p = await q.query<ProductionRow & Record<string, unknown>>(
    `SELECT ${PRODUCTION_COLUMNS} FROM catalog.productions p
      WHERE p.id = $1 AND EXISTS (SELECT 1 FROM catalog.events e WHERE e.production_id = p.id AND e.status = 'published')`,
    [id],
  );
  if (!p.rows[0]) return null;
  const terms = await q.query<Omit<PublicTerm, 'occupancyPct'> & Record<string, unknown>>(
    `SELECT ${TERM_SELECT}
       FROM catalog.events e LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE e.production_id = $1 AND e.status = 'published' AND e.date_start > now()
      ORDER BY e.date_start`,
    [id],
  );
  return { production: toProductionCard(p.rows[0]), terms: terms.rows.map(withPct) };
}

export interface ProgramFilter { city?: string | null; month?: string | null; promoterId?: string | null }

export interface ProgramEvent extends PublicTerm { productionId: string | null; title: string }

export async function loadProgram(q: Q, f: ProgramFilter): Promise<Array<{ city: string; events: ProgramEvent[] }>> {
  const where = [`e.status = 'published'`, `e.date_start > now()`];
  const params: unknown[] = [];
  if (f.city) { params.push(f.city); where.push(`lower(v.city) = lower($${params.length})`); }
  if (f.month) {
    params.push(`${f.month}-01`);
    where.push(`(e.date_start AT TIME ZONE 'Europe/Prague') >= $${params.length}::date
                AND (e.date_start AT TIME ZONE 'Europe/Prague') < ($${params.length}::date + interval '1 month')`);
  }
  if (f.promoterId) { params.push(f.promoterId); where.push(`e.promoter_id = $${params.length}`); }
  const r = await q.query<Omit<PublicTerm, 'occupancyPct'> & { productionId: string | null; title: string } & Record<string, unknown>>(
    `SELECT ${TERM_SELECT}, e.production_id AS "productionId", e.title
       FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id
      WHERE ${where.join(' AND ')}
      ORDER BY lower(v.city), e.date_start
      LIMIT 1000`,
    params,
  );
  const byCity = new Map<string, ProgramEvent[]>();
  for (const row of r.rows) {
    const list = byCity.get(row.city) ?? [];
    list.push(withPct(row));
    byCity.set(row.city, list);
  }
  return [...byCity.entries()].map(([city, events]) => ({ city, events }));
}
