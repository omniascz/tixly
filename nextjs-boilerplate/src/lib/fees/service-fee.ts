/**
 * Service fee pro koncového zákazníka (buyer) — JEDEN zdroj pravdy.
 *
 * Master admin nastaví promotérovi `buyer_fee_halire` (fixní částka) + `buyer_fee_basis`
 * (per_ticket / per_order) v platform.fee_schedules. Tenhle helper to vyhodnotí pro
 * konkrétní nákup. Používá ho checkout (skutečné naúčtování) i price-preview (náhled
 * pro buyera) — aby buyer předem viděl přesně to, co zaplatí.
 *
 * Fee je platform revenue: v checkoutu se přičte k total_amount a uloží do
 * orders.service_fee_minor, aby ho payout mohl vyloučit z promotérova gross.
 */

export type ServiceFeeBasis = 'per_ticket' | 'per_order';

export interface ServiceFeeResult {
  /** Fixní fee na jednotku (haléře) dle nastavení promotéra. */
  unitFeeMinor: number;
  basis: ServiceFeeBasis;
  /** Celkové fee za tenhle nákup (haléře) — co buyer zaplatí navíc. */
  totalFeeMinor: number;
}

/** Cokoliv s `.query()` — pg.PoolClient (checkout tx) i db() pool (price-preview). */
interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * Vyřeší service fee pro daný nákup. Vrací 0, pokud promotér žádné buyer fee
 * pro danou měnu nemá (default stav — žádná přirážka).
 */
export async function resolveServiceFee(
  exec: Queryable,
  opts: { promoterId: string; currency: string; quantity: number },
): Promise<ServiceFeeResult> {
  const r = await exec.query<{ buyer_fee_halire: number; buyer_fee_basis: ServiceFeeBasis }>(
    `SELECT buyer_fee_halire, buyer_fee_basis
       FROM platform.fee_schedules
      WHERE promoter_id = $1 AND currency = $2 AND is_active = TRUE
        AND (valid_until IS NULL OR valid_until > NOW())
        AND (valid_from IS NULL OR valid_from <= NOW())
      ORDER BY created_at DESC
      LIMIT 1`,
    [opts.promoterId, opts.currency],
  );
  const unitFeeMinor = Math.max(0, r.rows[0]?.buyer_fee_halire ?? 0);
  const basis: ServiceFeeBasis = r.rows[0]?.buyer_fee_basis ?? 'per_ticket';
  const qty = Math.max(1, opts.quantity);
  const totalFeeMinor =
    unitFeeMinor <= 0 ? 0 : basis === 'per_ticket' ? unitFeeMinor * qty : unitFeeMinor;
  return { unitFeeMinor, basis, totalFeeMinor };
}
