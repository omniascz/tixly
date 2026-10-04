/**
 * Kolo 8 / krok 4 — slevové kategorie (catalog.price_categories + price_category_prices).
 *
 * Cena kategorie v zóně (ticket_types = zóna, base_price = plná cena zóny): výjimka pro zónu
 * (price_category_prices), jinak výchozí pravidlo kategorie — procento z plné ceny (price_value = % × 100,
 * zaokrouhlení na haléře 0,5 nahoru) nebo pevná částka. Cena se počítá VŽDY na serveru.
 * Pravidla nákupu: doprovod ZTP/P jen spolu se ZTP/P ve stejné objednávce, max. 1 doprovod na 1 ZTP/P;
 * limit počtu kusů kategorie na termín (počítá zaplacené a živé nezaplacené objednávky + tento nákup).
 */

interface Q {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export type CategoryKind = 'full' | 'senior' | 'student' | 'ztp' | 'ztpp' | 'ztpp_companion' | 'child' | 'custom';

export interface CategoryInput {
  code: string;
  name: string;
  kind: CategoryKind;
  priceMode: 'percent' | 'fixed';
  /** percent: procenta × 100 (7000 = 70 %); fixed: haléře */
  priceValue: number;
  requiresProof?: boolean;
  proofLabel?: string | null;
  limitPerEvent?: number | null;
  sortOrder?: number;
}

/** Výchozí šablona pro nový pořadatelský účet (procenta jsou výchozí návrh, pořadatel je upraví). */
export const DEFAULT_CATEGORY_TEMPLATE: CategoryInput[] = [
  { code: 'plne', name: 'Plné', kind: 'full', priceMode: 'percent', priceValue: 10000, sortOrder: 0 },
  { code: 'senior', name: 'Senior', kind: 'senior', priceMode: 'percent', priceValue: 8000, requiresProof: true, proofLabel: 'Senior (věk)', sortOrder: 1 },
  { code: 'student', name: 'Student', kind: 'student', priceMode: 'percent', priceValue: 7000, requiresProof: true, proofLabel: 'Student (ISIC)', sortOrder: 2 },
  { code: 'ztp', name: 'ZTP', kind: 'ztp', priceMode: 'percent', priceValue: 5000, requiresProof: true, proofLabel: 'ZTP', sortOrder: 3 },
  { code: 'ztpp', name: 'ZTP/P', kind: 'ztpp', priceMode: 'percent', priceValue: 5000, requiresProof: true, proofLabel: 'ZTP/P', sortOrder: 4 },
  { code: 'doprovod-ztpp', name: 'Doprovod ZTP/P', kind: 'ztpp_companion', priceMode: 'fixed', priceValue: 0, sortOrder: 5 },
  { code: 'dite', name: 'Dítě', kind: 'child', priceMode: 'percent', priceValue: 5000, sortOrder: 6 },
];

export function categoryPriceMinor(fullPriceMinor: number, mode: 'percent' | 'fixed', value: number): number {
  if (mode === 'fixed') return value;
  return Math.floor((fullPriceMinor * value + 5000) / 10000);
}

export interface CategoryRow extends Record<string, unknown> {
  id: string; code: string; name: string; kind: CategoryKind; price_mode: 'percent' | 'fixed'; price_value: number;
  requires_proof: boolean; proof_label: string | null; limit_per_event: number | null; sort_order: number;
}

export async function listCategories(q: Q, promoterId: string, eventId: string | null): Promise<CategoryRow[]> {
  return (await q.query<CategoryRow>(
    `SELECT id, code, name, kind, price_mode, price_value, requires_proof, proof_label, limit_per_event, sort_order
       FROM catalog.price_categories
      WHERE promoter_id = $1 AND (($2::uuid IS NULL AND event_id IS NULL) OR event_id = $2)
      ORDER BY sort_order, name`,
    [promoterId, eventId],
  )).rows;
}

export async function upsertCategory(q: Q, promoterId: string, eventId: string | null, c: CategoryInput): Promise<string> {
  const existing = (await q.query<{ id: string }>(
    `SELECT id FROM catalog.price_categories WHERE promoter_id = $1 AND code = $2 AND (($3::uuid IS NULL AND event_id IS NULL) OR event_id = $3)`,
    [promoterId, c.code, eventId],
  )).rows[0];
  const vals = [c.name, c.kind, c.priceMode, c.priceValue, c.requiresProof ?? false, c.proofLabel ?? null, c.limitPerEvent ?? null, c.sortOrder ?? 0];
  if (existing) {
    await q.query(
      `UPDATE catalog.price_categories SET name = $2, kind = $3, price_mode = $4, price_value = $5, requires_proof = $6,
              proof_label = $7, limit_per_event = $8, sort_order = $9, updated_at = now() WHERE id = $1`,
      [existing.id, ...vals],
    );
    return existing.id;
  }
  return (await q.query<{ id: string }>(
    `INSERT INTO catalog.price_categories (promoter_id, event_id, code, name, kind, price_mode, price_value, requires_proof, proof_label, limit_per_event, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [promoterId, eventId, c.code, ...vals],
  )).rows[0].id;
}

/** Výchozí šablonu pořadatele (nebo vestavěnou, když žádnou nemá) použije pro termín jedním krokem. */
export async function applyTemplate(q: Q, promoterId: string, eventId: string): Promise<number> {
  const tpl = await listCategories(q, promoterId, null);
  const source: CategoryInput[] = tpl.length > 0
    ? tpl.map((t) => ({
        code: t.code, name: t.name, kind: t.kind, priceMode: t.price_mode, priceValue: t.price_value, requiresProof: t.requires_proof,
        proofLabel: t.proof_label, limitPerEvent: t.limit_per_event, sortOrder: t.sort_order,
      }))
    : DEFAULT_CATEGORY_TEMPLATE;
  for (const c of source) await upsertCategory(q, promoterId, eventId, c);
  return source.length;
}

export async function setZonePrice(q: Q, promoterId: string, categoryId: string, ticketTypeId: string, mode: 'percent' | 'fixed', value: number): Promise<void> {
  await q.query(
    `INSERT INTO catalog.price_category_prices (category_id, ticket_type_id, promoter_id, price_mode, price_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (category_id, ticket_type_id) DO UPDATE SET price_mode = EXCLUDED.price_mode, price_value = EXCLUDED.price_value`,
    [categoryId, ticketTypeId, promoterId, mode, value],
  );
}

export interface PriceCell { categoryId: string; ticketTypeId: string; priceMinor: number }

/** Ceník termínu: kategorie × zóna → cena (haléře). */
export async function priceTable(q: Q, eventId: string): Promise<{ categories: CategoryRow[]; zones: Array<{ id: string; name: string; base_price: number }>; prices: PriceCell[] }> {
  const categories = (await q.query<CategoryRow>(
    `SELECT id, code, name, kind, price_mode, price_value, requires_proof, proof_label, limit_per_event, sort_order
       FROM catalog.price_categories WHERE event_id = $1 ORDER BY sort_order, name`,
    [eventId],
  )).rows;
  const zones = (await q.query<{ id: string; name: string; base_price: number }>(
    `SELECT id, COALESCE(zone, name) AS name, base_price FROM catalog.ticket_types WHERE event_id = $1 ORDER BY base_price DESC, name`,
    [eventId],
  )).rows;
  const overrides = (await q.query<{ category_id: string; ticket_type_id: string; price_mode: 'percent' | 'fixed'; price_value: number }>(
    `SELECT p.category_id, p.ticket_type_id, p.price_mode, p.price_value FROM catalog.price_category_prices p
       JOIN catalog.price_categories c ON c.id = p.category_id WHERE c.event_id = $1`,
    [eventId],
  )).rows;
  const ov = new Map(overrides.map((o) => [`${o.category_id}|${o.ticket_type_id}`, o]));
  const prices: PriceCell[] = [];
  for (const c of categories) {
    for (const z of zones) {
      const o = ov.get(`${c.id}|${z.id}`);
      prices.push({ categoryId: c.id, ticketTypeId: z.id, priceMinor: o ? categoryPriceMinor(z.base_price, o.price_mode, o.price_value) : categoryPriceMinor(z.base_price, c.price_mode, c.price_value) });
    }
  }
  return { categories, zones, prices };
}

export class CategoryRuleError extends Error {
  constructor(public code: 'UNKNOWN_CATEGORY' | 'COMPANION_WITHOUT_ZTPP' | 'TOO_MANY_COMPANIONS' | 'CATEGORY_LIMIT', message: string) {
    super(message);
  }
}

export interface PricedSeat { seatId: string; ticketTypeId: string; categoryId: string; categoryCode: string; categoryName: string; priceMinor: number; proofLabel: string | null }

/**
 * Ověří výběr kategorií u míst a spočítá ceny na serveru.
 * seats: zamknutá místa termínu (id → ticket_type_id); items: požadavek kupce (místo → kategorie).
 */
export async function priceSeats(
  q: Q, eventId: string, seats: Array<{ id: string; ticket_type_id: string }>, items: Array<{ seatId: string; categoryId: string }>,
): Promise<PricedSeat[]> {
  const table = await priceTable(q, eventId);
  const cat = new Map(table.categories.map((c) => [c.id, c]));
  const price = new Map(table.prices.map((p) => [`${p.categoryId}|${p.ticketTypeId}`, p.priceMinor]));
  const seatType = new Map(seats.map((s) => [s.id, s.ticket_type_id]));
  const priced = items.map((it) => {
    const c = cat.get(it.categoryId);
    const tt = seatType.get(it.seatId);
    if (!c || !tt || !price.has(`${c.id}|${tt}`)) throw new CategoryRuleError('UNKNOWN_CATEGORY', 'Neplatná slevová kategorie pro toto místo.');
    return {
      seatId: it.seatId, ticketTypeId: tt, categoryId: c.id, categoryCode: c.code, categoryName: c.name,
      priceMinor: price.get(`${c.id}|${tt}`)!, proofLabel: c.requires_proof ? c.proof_label ?? c.name : null,
    };
  });
  const kindCount = (k: CategoryKind) => priced.filter((p) => cat.get(p.categoryId)?.kind === k).length;
  const companions = kindCount('ztpp_companion');
  const ztpp = kindCount('ztpp');
  if (companions > 0 && ztpp === 0) {
    throw new CategoryRuleError('COMPANION_WITHOUT_ZTPP', 'Vstupenku „Doprovod ZTP/P" lze koupit jen spolu se vstupenkou ZTP/P ve stejné objednávce.');
  }
  if (companions > ztpp) {
    throw new CategoryRuleError('TOO_MANY_COMPANIONS', 'Na jednu vstupenku ZTP/P připadá nejvýš jeden doprovod.');
  }
  // limity na termín (zaplacené + živé nezaplacené objednávky)
  const counts = new Map<string, number>();
  for (const p of priced) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);
  for (const [categoryId, n] of counts) {
    const c = cat.get(categoryId)!;
    if (c.limit_per_event === null || c.limit_per_event === undefined) continue;
    // souběžné nákupy téže kategorie se serializují (jinak by si navzájem neviděly necommitnuté kusy)
    await q.query(`SELECT pg_advisory_xact_lock(hashtext('price-category-limit:' || $1::text))`, [categoryId]);
    const used = (await q.query<{ n: number }>(
      `SELECT count(*)::int n FROM orders.order_items oi JOIN orders.orders o ON o.id = oi.order_id
        WHERE oi.price_category_id = $1 AND o.event_id = $2
          AND (o.status IN ('paid', 'paid_partial') OR (o.status = 'pending' AND o.expires_at > now()))`,
      [categoryId, eventId],
    )).rows[0].n;
    if (used + n > c.limit_per_event) {
      throw new CategoryRuleError('CATEGORY_LIMIT', `Kategorie „${c.name}" je pro tento termín vyprodaná (zbývá ${Math.max(0, c.limit_per_event - used)}).`);
    }
  }
  return priced;
}
