/**
 * Compute insurance premium given subtotal + plan.
 * - price_pct: percentage of subtotal_halire
 * - price_flat_halire: fixed amount
 * Pokud oba, použij vyšší.
 */
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface InsuranceComputation {
  planId: string;
  planName: string;
  provider: string;
  premiumHalire: number;
  details: string;
}

export async function computeInsurancePremium(
  planId: string,
  subtotalHalire: number,
): Promise<InsuranceComputation | null> {
  const r = await db().query<{
    id: string;
    name: string;
    provider: string;
    price_pct: number | null;
    price_flat_halire: number | null;
    is_active: boolean;
  }>(
    `SELECT id, name, provider, price_pct, price_flat_halire, is_active
       FROM catalog.insurance_plans
      WHERE id = $1`,
    [planId],
  );
  if (r.rows.length === 0 || !r.rows[0].is_active) return null;
  const plan = r.rows[0];

  const pctPremium = plan.price_pct !== null
    ? Math.round((subtotalHalire * Number(plan.price_pct)) / 100)
    : 0;
  const flatPremium = plan.price_flat_halire ?? 0;
  const premium = Math.max(pctPremium, flatPremium);

  const details = plan.price_pct !== null
    ? `${plan.price_pct}% z ceny lístků`
    : `${(flatPremium / 100).toFixed(0)} Kč fixní`;

  return {
    planId: plan.id,
    planName: plan.name,
    provider: plan.provider,
    premiumHalire: premium,
    details,
  };
}
