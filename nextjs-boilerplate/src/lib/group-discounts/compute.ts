/**
 * Group discount engine — vrátí nejlepší match tier pro daný ticket_type + qty.
 *
 * Eg.:
 *   5+ = 10% off
 *   10+ = 20% off
 *   buyer kupuje 7 → 10% sleva (5+ tier, ne 10+ ještě)
 */
import { db } from "@/lib/db/rls-pool";


export interface DiscountResult {
  applied: boolean;
  tierId: string | null;
  label: string;
  discountPct: number;
  discountFlatHalire: number;
  perTicketSavingHalire: number;
  totalSavingHalire: number;
}

export async function computeGroupDiscount(input: {
  ticketTypeId: string;
  quantity: number;
  unitPriceHalire: number;
}): Promise<DiscountResult> {
  if (input.quantity < 2) {
    return zero();
  }

  const r = await db().query<{
    id: string;
    label: string;
    discount_pct: number | null;
    discount_flat_halire: number | null;
    min_quantity: number;
  }>(
    `SELECT id, label, discount_pct, discount_flat_halire, min_quantity
       FROM catalog.group_discount_tiers
      WHERE ticket_type_id = $1
        AND min_quantity <= $2
      ORDER BY min_quantity DESC
      LIMIT 1`,
    [input.ticketTypeId, input.quantity],
  );

  if (r.rows.length === 0) return zero();
  const tier = r.rows[0];

  let perTicketSaving = 0;
  if (tier.discount_pct !== null) {
    perTicketSaving = Math.round(input.unitPriceHalire * (Number(tier.discount_pct) / 100));
  } else if (tier.discount_flat_halire !== null) {
    perTicketSaving = tier.discount_flat_halire;
  }

  return {
    applied: true,
    tierId: tier.id,
    label: tier.label,
    discountPct: Number(tier.discount_pct ?? 0),
    discountFlatHalire: tier.discount_flat_halire ?? 0,
    perTicketSavingHalire: perTicketSaving,
    totalSavingHalire: perTicketSaving * input.quantity,
  };
}

function zero(): DiscountResult {
  return {
    applied: false, tierId: null, label: '',
    discountPct: 0, discountFlatHalire: 0,
    perTicketSavingHalire: 0, totalSavingHalire: 0,
  };
}

/**
 * List all tiers pro ticket_type (pro admin UI / checkout display).
 */
export async function listGroupDiscountTiers(ticketTypeId: string): Promise<Array<{
  id: string; min_quantity: number; label: string;
  discount_pct: number | null; discount_flat_halire: number | null;
}>> {
  const r = await db().query<{
    id: string; min_quantity: number; label: string;
    discount_pct: number | null; discount_flat_halire: number | null;
  }>(
    `SELECT id, min_quantity, label, discount_pct, discount_flat_halire
       FROM catalog.group_discount_tiers
      WHERE ticket_type_id = $1
      ORDER BY min_quantity`,
    [ticketTypeId],
  );
  return r.rows;
}
