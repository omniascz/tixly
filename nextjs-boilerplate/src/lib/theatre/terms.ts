/**
 * Kolo 8 / krok 1 — termín inscenace (catalog.events s production_id).
 *
 * Termín = inscenace + sál + datum a čas + ceník + nastavení prodeje. Údaje karty (název, popis, autor,
 * režie, obsazení…) se berou z inscenace; termín je smí jen doplnit (term_note, cast_alternation).
 * Ceník lze zkopírovat z předchozího termínu (typy vstupenek včetně zóny a kódu sazby DPH).
 * Sedadla se při založení zkopírují z aktivního plánku sálu (copyLayoutToEventSeats).
 *
 * Publikace: první termín inscenace jde do moderace (pending_review) jako každá nová akce. Další termín
 * už schválené inscenace (má publikovaný termín) se publikuje rovnou — obsah je tentýž; DPH se ověří.
 * Běží v transakci volajícího s RLS kontextem pořadatele (tixly_app, žádný bypass).
 */
import type { PoolClient } from 'pg';
import { copyLayoutToEventSeats } from '@/lib/seats/copy-layout-to-event-seats';
import { vatReadinessProblems } from '@/lib/tax/vat-readiness';

export class TermError extends Error {
  constructor(public code: 'PRODUCTION_NOT_FOUND' | 'VENUE_NOT_FOUND' | 'SOURCE_NOT_FOUND' | 'NO_TICKET_TYPES' | 'VAT_NOT_CONFIGURED' | 'NO_SELLABLE_SEATS', message: string, public details?: unknown) {
    super(message);
  }
}

export interface TermTicketTypeInput {
  name: string;
  priceHalire: number;
  capacity?: number;
  zone?: string | null;
  isSeated?: boolean;
  vatRateCode?: string | null;
  maxPerUser?: number | null;
}

export interface CreateTermInput {
  productionId: string;
  venueId: string;
  dateStart: string;
  dateEnd?: string | null;
  salesEndAt?: string | null;
  termNote?: string | null;
  castAlternation?: string | null;
  /** Zkopírovat ceník (typy vstupenek) z dřívějšího termínu téhož pořadatele. */
  copyPricingFromEventId?: string | null;
  /** Kolo 8 / krok 2: ceny podle cenových zón plánku sálu (typ vstupenky = zóna). */
  zonePrices?: Array<{ zone: string; priceHalire: number; vatRateCode?: string | null }>;
  ticketTypes?: TermTicketTypeInput[];
}

export interface CreateTermResult {
  eventId: string;
  status: 'published' | 'pending_review';
  ticketTypes: number;
  seats: number;
}

/** „12+" / „od 15 let" → 12 / 15; jinak null. */
export function minAgeFromRating(rating: string | null | undefined): number | null {
  const m = /(\d{1,2})/.exec(rating ?? '');
  return m ? Number(m[1]) : null;
}

export async function createTerm(client: PoolClient, promoterId: string, userId: string, input: CreateTermInput): Promise<CreateTermResult> {
  const prod = (await client.query<{ id: string; title: string; description: string | null; age_rating: string | null; duration_min: number | null; published_terms: number }>(
    `SELECT p.id, p.title, p.description, p.age_rating, p.duration_min,
            (SELECT count(*)::int FROM catalog.events e WHERE e.production_id = p.id AND e.status = 'published') AS published_terms
       FROM catalog.productions p WHERE p.id = $1 AND p.promoter_id = $2`,
    [input.productionId, promoterId],
  )).rows[0];
  if (!prod) throw new TermError('PRODUCTION_NOT_FOUND', 'Inscenace nenalezena.');

  const venue = (await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM catalog.venues WHERE id = $1 AND (promoter_id = $2 OR promoter_id IS NULL)`,
    [input.venueId, promoterId],
  )).rows[0];
  if (!venue) throw new TermError('VENUE_NOT_FOUND', 'Sál nenalezen.');

  let ticketTypes: Array<TermTicketTypeInput & { capacity: number }>;
  if (input.copyPricingFromEventId) {
    const src = await client.query<{ name: string; base_price: number; total_qty: number; zone: string | null; is_seated: boolean; vat_rate_code: string | null; max_per_user: number | null }>(
      `SELECT tt.name, tt.base_price, tt.total_qty, tt.zone, COALESCE(tt.is_seated, false) AS is_seated, tt.vat_rate_code, tt.max_per_user
         FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
        WHERE e.id = $1 AND e.promoter_id = $2
        ORDER BY tt.base_price DESC, tt.name`,
      [input.copyPricingFromEventId, promoterId],
    );
    if (src.rows.length === 0) throw new TermError('SOURCE_NOT_FOUND', 'Termín, ze kterého se má převzít ceník, nebyl nalezen nebo nemá ceník.');
    ticketTypes = src.rows.map((t) => ({
      name: t.name, priceHalire: t.base_price, capacity: t.total_qty, zone: t.zone, isSeated: t.is_seated,
      vatRateCode: t.vat_rate_code, maxPerUser: t.max_per_user,
    }));
  } else if (input.zonePrices && input.zonePrices.length > 0) {
    const chart = (await client.query<{ zones: Array<{ id: string; name: string }> | null }>(
      `SELECT layout->'zones' AS zones FROM catalog.venue_seating_charts WHERE venue_id = $1 AND active = true ORDER BY created_at DESC LIMIT 1`,
      [input.venueId],
    )).rows[0];
    const names = new Set((chart?.zones ?? []).map((z) => z.name));
    const unknown = input.zonePrices.filter((z) => !names.has(z.zone)).map((z) => z.zone);
    if (unknown.length > 0) throw new TermError('NO_TICKET_TYPES', `Plánek sálu nemá cenové zóny: ${unknown.join(', ')}`);
    ticketTypes = input.zonePrices.map((z) => ({
      name: z.zone, priceHalire: z.priceHalire, capacity: 1, zone: z.zone, isSeated: true, vatRateCode: z.vatRateCode ?? null, maxPerUser: null,
    }));
  } else if (input.ticketTypes && input.ticketTypes.length > 0) {
    ticketTypes = input.ticketTypes.map((t) => ({
      name: t.name, priceHalire: t.priceHalire, capacity: t.capacity ?? 1, zone: t.zone ?? null, isSeated: t.isSeated ?? Boolean(t.zone),
      vatRateCode: t.vatRateCode ?? null, maxPerUser: t.maxPerUser ?? null,
    }));
  } else {
    throw new TermError('NO_TICKET_TYPES', 'Zadejte ceník nebo termín, ze kterého se má převzít.');
  }

  const dateEnd = input.dateEnd
    ?? (prod.duration_min ? new Date(new Date(input.dateStart).getTime() + prod.duration_min * 60_000).toISOString() : null);
  const ev = (await client.query<{ id: string }>(
    `INSERT INTO catalog.events
       (organizer_id, promoter_id, venue_id, production_id, title, description, category, event_type,
        date_start, date_end, sales_end_at, status, min_age, currency, timezone, term_note, cast_alternation,
        slug, created_at, updated_at)
     VALUES ($1, $1, $2, $3, $4, $5, 'theatre', 'theatre', $6, $7, $8, 'pending_review', $9, 'CZK', 'Europe/Prague', $10, $11,
             regexp_replace(regexp_replace(lower(translate($4, 'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ', 'acdeeinorstuuyzacdeeinorstuuyz')), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')
               || '-' || to_char($6::timestamptz AT TIME ZONE 'Europe/Prague', 'YYYYMMDD-HH24MI') || '-' || substring(gen_random_uuid()::text FROM 1 FOR 4),
             now(), now())
     RETURNING id`,
    [promoterId, input.venueId, prod.id, prod.title, prod.description, input.dateStart, dateEnd, input.salesEndAt ?? null,
     minAgeFromRating(prod.age_rating), input.termNote ?? null, input.castAlternation ?? null],
  )).rows[0];

  await client.query(
    `INSERT INTO catalog.event_days (event_id, day_index, starts_at, ends_at, label) VALUES ($1, 0, $2, $3, 'Hlavní termín')`,
    [ev.id, input.dateStart, dateEnd ?? input.dateStart],
  );
  await client.query(`INSERT INTO catalog.event_zones (event_id, name, zone_type, display_order) VALUES ($1, 'Hlavní', 'general', 0)`, [ev.id]);

  for (const tt of ticketTypes) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO catalog.ticket_types
         (event_id, name, kind, base_price, total_qty, remaining_qty, max_per_user, zone, is_seated, vat_rate_code, visibility, created_at)
       VALUES ($1, $2, 'standing', $3, $4, $4, $5, $6, $7, $8, 'public', now()) RETURNING id`,
      [ev.id, tt.name, tt.priceHalire, Math.max(1, tt.capacity), tt.maxPerUser ?? null, tt.zone ?? null, tt.isSeated ?? false, tt.vatRateCode ?? null],
    );
    await client.query(
      `INSERT INTO catalog.ticket_type_access (ticket_type_id, event_day_id, zone_id, access_level) VALUES ($1, NULL, NULL, 'general')`,
      [r.rows[0].id],
    );
  }

  const seats = await copyLayoutToEventSeats(client, ev.id);
  // Kapacita sedadlových typů = skutečný počet míst v sále (ne číslo z předlohy).
  await client.query(
    `UPDATE catalog.ticket_types tt SET total_qty = s.n, remaining_qty = s.n
       FROM (SELECT ticket_type_id, count(*)::int n FROM catalog.event_seats WHERE event_id = $1 AND status = 'available' GROUP BY ticket_type_id) s
      WHERE tt.id = s.ticket_type_id AND tt.event_id = $1`,
    [ev.id],
  );

  // Kolo 12: sál, jehož plánek nemá místa přiřazená do cenových zón, dřív vytvořil termín „v prodeji (0 míst)".
  // Celá transakce se vrátí (route ROLLBACK) — nevznikne termín, který nejde prodávat.
  if (ticketTypes.some((t) => t.isSeated)) {
    const sellable = (await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM catalog.event_seats WHERE event_id = $1 AND status = 'available' AND ticket_type_id IS NOT NULL`, [ev.id],
    )).rows[0]?.n ?? 0;
    if (sellable === 0) {
      throw new TermError('NO_SELLABLE_SEATS',
        `Termín nejde založit: plánek sálu „${venue.name}" nemá žádná místa přiřazená do cenových zón (${seats.insertedSeats} míst bez zóny). ` +
        'Otevřete Sály → Editor plánku, vyberte místa, v části „Cenové zóny" klikněte na „Přiřadit výběru" a plánek uložte. Pak termín založte znovu.');
    }
  }

  let status: CreateTermResult['status'] = 'pending_review';
  if (prod.published_terms > 0) {
    const problems = await vatReadinessProblems(client, ev.id);
    if (problems.length > 0) throw new TermError('VAT_NOT_CONFIGURED', 'Termín nelze publikovat — DPH není nastavené.', problems);
    await client.query(`UPDATE catalog.events SET status = 'published', updated_at = now() WHERE id = $1`, [ev.id]);
    status = 'published';
  }
  await client.query(
    `INSERT INTO audit.event_moderation_log (event_id, actor_user_id, actor_type, decision, reason, matched_keywords)
     VALUES ($1, $2, 'auto_ai', $3, $4, '{}')`,
    [ev.id, userId, status === 'published' ? 'approved' : 'submitted',
     status === 'published' ? 'Kolo 8: další termín schválené inscenace — obsah převzat z inscenace' : 'Kolo 8: první termín inscenace — moderace'],
  );

  return { eventId: ev.id, status, ticketTypes: ticketTypes.length, seats: seats.insertedSeats };
}
