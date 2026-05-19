/**
 * Server-side price resolution — JEDINÁ autorita pro cenu vstupenky.
 *
 * Hierarchie (top-down, vyšší vyhrává):
 *   1. pricing.price_tiers.total_hellers   — All-In Pricing (face + fee + VAT)
 *      → použito pro display TOTAL (final cena pro kupce)
 *   2. catalog.pricing_rules.price          — fázové (early_bird/regular/late/door)
 *      → aktivní pravidlo s nejnižší priority value (= nejvyšší prioritou) vyhraje;
 *        threshold_qty + threshold_date určují, zda je pravidlo aktivní
 *   3. catalog.ticket_types.base_price      — fallback default
 *
 * Tato funkce se MUSÍ volat na serveru z trusted kontextu (checkout, billing).
 * NIKDY nesmí klient poslat cenu v requestu — server ji vždy resolve sám.
 */


export type PriceSource = 'tier' | 'rule' | 'base';

export interface ResolvedPrice {
  unitPriceHalire: number;
  source: PriceSource;
  ticketTypeId: string;
  ruleId: string | null;
  tierId: string | null;
}

// Kompatibilní podtyp pro pg.Pool / pg.PoolClient — přijímá oba (a fake DB
// stuby v testech). Záměrně volně typovaný kvůli pg.Pool overloaded query
// signatures, které TS nezvládá zúžit.
type DbExecutor = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

interface TicketTypeRow {
  id: string;
  event_id: string;
  base_price: number;
  remaining_qty: number;
}

interface PricingRuleRow {
  id: string;
  price: number;
  threshold_qty: number | null;
  threshold_date: string | null;
}

interface PriceTierRow {
  id: string;
  total_hellers: number;
}

/**
 * Vrátí aktuální cenu vstupenky pro daný čas (default NOW).
 *
 * Pokud `expectedHalire` je předán, funkce vyhodí PriceMismatchError, když
 * neodpovídá serverové ceně — to chrání před útokem, kdy klient pošle cenu
 * spolu s objednávkou. (Ideálně klient cenu vůbec neposílá.)
 */
export async function resolveCurrentPrice(
  ticketTypeId: string,
  eventId: string,
  db: DbExecutor,
  options?: { now?: Date; expectedHalire?: number },
): Promise<ResolvedPrice> {
  const now = options?.now ?? new Date();

  const ttRes = (await db.query(
    `SELECT id, event_id, base_price, remaining_qty
     FROM catalog.ticket_types
     WHERE id = $1 AND event_id = $2
     LIMIT 1`,
    [ticketTypeId, eventId],
  )) as { rows: TicketTypeRow[] };
  if (ttRes.rows.length === 0) {
    throw new PriceResolutionError(
      'TICKET_TYPE_NOT_FOUND',
      `Ticket type ${ticketTypeId} not found for event ${eventId}`,
    );
  }
  const tt = ttRes.rows[0];

  // 1) All-In tier override (display total)
  // Tabulka pricing.price_tiers je z migrace 133 a v některých prostředích
  // (lokální demo) ještě nemusí být aplikovaná. Existence kontrolujeme předem
  // (cached), aby pád nezneškodnil aktuální transakci (chyba 25P02).
  let tierRow: PriceTierRow | undefined;
  if (await tableExists(db, 'pricing', 'price_tiers')) {
    const tierRes = (await db.query(
      `SELECT id, total_hellers
       FROM pricing.price_tiers
       WHERE event_id = $1 AND ticket_type_id = $2
       LIMIT 1`,
      [eventId, ticketTypeId],
    )) as { rows: PriceTierRow[] };
    tierRow = tierRes.rows[0];
  }
  if (tierRow) {
    return finalize(
      {
        unitPriceHalire: tierRow.total_hellers,
        source: 'tier',
        ticketTypeId,
        ruleId: null,
        tierId: tierRow.id,
      },
      options?.expectedHalire,
    );
  }

  // 2) Pricing rule (active = threshold satisfied, lowest priority wins)
  let ruleRows: PricingRuleRow[] = [];
  if (await tableExists(db, 'catalog', 'pricing_rules')) {
    const ruleRes = (await db.query(
      `SELECT id, price, threshold_qty, threshold_date
       FROM catalog.pricing_rules
       WHERE ticket_type_id = $1 AND active = TRUE
       ORDER BY priority ASC, created_at ASC`,
      [ticketTypeId],
    )) as { rows: PricingRuleRow[] };
    ruleRows = ruleRes.rows;
  }
  for (const rule of ruleRows) {
    const dateOk =
      rule.threshold_date === null || new Date(rule.threshold_date) <= now;
    const qtyOk =
      rule.threshold_qty === null || tt.remaining_qty <= rule.threshold_qty;
    if (dateOk && qtyOk) {
      return finalize(
        {
          unitPriceHalire: rule.price,
          source: 'rule',
          ticketTypeId,
          ruleId: rule.id,
          tierId: null,
        },
        options?.expectedHalire,
      );
    }
  }

  // 3) Fallback: base price
  return finalize(
    {
      unitPriceHalire: tt.base_price,
      source: 'base',
      ticketTypeId,
      ruleId: null,
      tierId: null,
    },
    options?.expectedHalire,
  );
}

function finalize(price: ResolvedPrice, expected?: number): ResolvedPrice {
  if (expected !== undefined && expected !== price.unitPriceHalire) {
    throw new PriceMismatchError(price.unitPriceHalire, expected);
  }
  return price;
}

export class PriceMismatchError extends Error {
  readonly code = 'PRICE_MISMATCH' as const;
  constructor(
    readonly serverPriceHalire: number,
    readonly clientPriceHalire: number,
  ) {
    super(
      `Server price ${serverPriceHalire} haléřů does not match client-supplied ${clientPriceHalire} haléřů`,
    );
    this.name = 'PriceMismatchError';
  }
}

export class PriceResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PriceResolutionError';
  }
}

// Cache: table existence rarely changes during process lifetime.
// Reset by restarting the process (or by running migrations and restarting).
const tableExistsCache = new Map<string, boolean>();

async function tableExists(
  db: DbExecutor,
  schema: string,
  name: string,
): Promise<boolean> {
  const key = `${schema}.${name}`;
  const cached = tableExistsCache.get(key);
  if (cached !== undefined) return cached;
  const res = (await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    [schema, name],
  )) as { rows: Array<{ exists: boolean }> };
  const exists = res.rows[0]?.exists === true;
  tableExistsCache.set(key, exists);
  return exists;
}

/** @internal — exposed only for tests. */
export function _resetTableExistsCacheForTests(): void {
  tableExistsCache.clear();
}
