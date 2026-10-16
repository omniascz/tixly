/**
 * Kolo 8 / krok 4 — promo kód pro nákup míst se slevovými kategoriemi.
 *
 * Sleva se počítá z ceny KATEGORIE (už zlevněné ceny místa), jen z míst, na která kód platí:
 * applicable_category_codes (kategorie), applicable_ticket_type_ids (zóny), applicable_event_ids (termíny).
 * Navíc oproti stávajícímu checkoutu: kód musí patřit pořadateli termínu (created_by_organizer_id), platí
 * min_quantity / min_order_amount / max_uses_per_user. Kód se zamyká (FOR UPDATE) a jeho použití započítá.
 */
import type { PricedSeat } from './categories';

interface Q {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export class PromoError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

interface PromoRow extends Record<string, unknown> {
  id: string; type: string; discount_value: number; max_uses: number | null; uses_count: number; max_uses_per_user: number | null;
  valid_from: string | null; valid_until: string | null; min_quantity: number | null; min_order_amount: number | null;
  applicable_ticket_type_ids: string[] | null; applicable_event_ids: string[] | null; applicable_category_codes: string[] | null;
  active: boolean; created_by_organizer_id: string | null;
}

export interface PromoResult { promoCodeId: string; discountMinor: number; discountBySeat: Map<string, number> }

export async function applyPromo(
  q: Q, opts: { code: string; eventId: string; promoterId: string; userId: string; seats: PricedSeat[] },
): Promise<PromoResult> {
  const pc = (await q.query<PromoRow>(
    `SELECT id, type, discount_value, max_uses, uses_count, max_uses_per_user, valid_from, valid_until, min_quantity,
            min_order_amount, applicable_ticket_type_ids, applicable_event_ids, applicable_category_codes, active, created_by_organizer_id
       FROM marketing.promo_codes WHERE UPPER(code) = UPPER($1) FOR UPDATE`,
    [opts.code.trim()],
  )).rows[0];
  if (!pc || !pc.active || pc.created_by_organizer_id !== opts.promoterId) throw new PromoError('PROMO_CODE_INVALID', 'Slevový kód neexistuje nebo pro tuto akci neplatí.');
  const now = Date.now();
  if (pc.valid_from && new Date(pc.valid_from).getTime() > now) throw new PromoError('PROMO_CODE_NOT_YET_VALID', 'Slevový kód zatím neplatí.');
  if (pc.valid_until && new Date(pc.valid_until).getTime() < now) throw new PromoError('PROMO_CODE_EXPIRED', 'Platnost slevového kódu vypršela.');
  if (pc.max_uses !== null && pc.uses_count >= pc.max_uses) throw new PromoError('PROMO_CODE_USED_UP', 'Slevový kód je vyčerpaný.');
  if (pc.applicable_event_ids && pc.applicable_event_ids.length > 0 && !pc.applicable_event_ids.includes(opts.eventId)) {
    throw new PromoError('PROMO_CODE_INVALID', 'Slevový kód pro tuto akci neplatí.');
  }
  if (pc.max_uses_per_user !== null) {
    const used = (await q.query<{ n: number }>(
      `SELECT count(*)::int n FROM marketing.promo_code_usages WHERE promo_code_id = $1 AND user_id = $2`, [pc.id, opts.userId],
    )).rows[0].n;
    if (used >= pc.max_uses_per_user) throw new PromoError('PROMO_CODE_USED_UP', 'Slevový kód už jste použili.');
  }
  const eligible = opts.seats.filter((s) =>
    (!pc.applicable_category_codes || pc.applicable_category_codes.length === 0 || pc.applicable_category_codes.includes(s.categoryCode))
    && (!pc.applicable_ticket_type_ids || pc.applicable_ticket_type_ids.length === 0 || pc.applicable_ticket_type_ids.includes(s.ticketTypeId)));
  if (eligible.length === 0) throw new PromoError('PROMO_CODE_NOT_APPLICABLE', 'Slevový kód na vybrané kategorie a zóny neplatí.');
  const eligibleTotal = eligible.reduce((a, s) => a + s.priceMinor, 0);
  if (pc.min_quantity !== null && eligible.length < pc.min_quantity) throw new PromoError('PROMO_CODE_MIN_QUANTITY', `Slevový kód platí od ${pc.min_quantity} vstupenek.`);
  if (pc.min_order_amount !== null && eligibleTotal < pc.min_order_amount) throw new PromoError('PROMO_CODE_MIN_AMOUNT', 'Objednávka nedosahuje minimální částky pro slevový kód.');

  const discountBySeat = new Map<string, number>();
  if (pc.type === 'percentage') {
    for (const s of eligible) discountBySeat.set(s.seatId, Math.floor((s.priceMinor * pc.discount_value) / 100));
  } else if (pc.type === 'fixed') {
    // pevná sleva rozdělená poměrně na místa (zbytek na první místa), nejvýš do ceny
    const total = Math.min(eligibleTotal, pc.discount_value);
    let rest = total;
    eligible.forEach((s, i) => {
      const part = i === eligible.length - 1 ? rest : Math.floor((total * s.priceMinor) / Math.max(1, eligibleTotal));
      discountBySeat.set(s.seatId, part);
      rest -= part;
    });
  } else {
    throw new PromoError('PROMO_CODE_INVALID', 'Tento typ slevového kódu nelze u míst se slevovými kategoriemi použít.');
  }
  const discountMinor = [...discountBySeat.values()].reduce((a, b) => a + b, 0);
  await q.query(`UPDATE marketing.promo_codes SET uses_count = uses_count + 1, updated_at = now() WHERE id = $1`, [pc.id]);
  return { promoCodeId: pc.id, discountMinor, discountBySeat };
}
