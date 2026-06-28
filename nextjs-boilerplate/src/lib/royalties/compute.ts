/**
 * Výpočet royalty pro jednu objednávku.
 * Čistá funkce — bez DB, testovatelná.
 */

export interface RoyaltyAgreement {
  royalty_type: 'percent' | 'flat' | 'per_ticket' | 'percent_plus_flat';
  percent_rate: number | null;       // 15.0 = 15 %
  flat_amount_halire: number | null;
  per_ticket_halire: number | null;
  min_guarantee_halire: number | null;
  cap_halire: number | null;
}

/**
 * Spočítá royalty pro jednu objednávku.
 * Pro `flat` typ: vrátí 0 — flat se počítá jednou na konci (viz computeEventTotalRoyalty).
 */
export function computeOrderRoyalty(
  agreement: RoyaltyAgreement,
  ticketRevenueHalire: number,
  ticketsSold: number,
): number {
  let amount = 0;

  switch (agreement.royalty_type) {
    case 'percent':
      amount = Math.round((ticketRevenueHalire * (agreement.percent_rate ?? 0)) / 100);
      break;
    case 'per_ticket':
      amount = ticketsSold * (agreement.per_ticket_halire ?? 0);
      break;
    case 'percent_plus_flat':
      // Flat je jednorázový — při každém orderu přičítáme jen percent část.
      // Flat se přičítá jednou v rámci computePayoutTotal.
      amount = Math.round((ticketRevenueHalire * (agreement.percent_rate ?? 0)) / 100);
      break;
    case 'flat':
      // Flat se neakumuluje per-order; vrátíme 0 jako placeholder.
      amount = 0;
      break;
  }

  // Cap
  if (agreement.cap_halire !== null && amount > agreement.cap_halire) {
    amount = agreement.cap_halire;
  }

  return Math.max(0, amount);
}

/**
 * Spočítá celkový payout z ledger záznamů + případně přidá flat/min_guarantee.
 * Volá se při generování payout dávky.
 */
export function computePayoutTotal(
  agreement: RoyaltyAgreement,
  ledgerSum: number,  // SUM(royalty_amount_halire) z ledgeru
): number {
  let total = ledgerSum;

  // Přidat flat (jednorázový) — buď jako pevný základ nebo doplněk k percent
  if (
    agreement.royalty_type === 'flat' ||
    agreement.royalty_type === 'percent_plus_flat'
  ) {
    total += agreement.flat_amount_halire ?? 0;
  }

  // Min guarantee
  if (agreement.min_guarantee_halire !== null && total < agreement.min_guarantee_halire) {
    total = agreement.min_guarantee_halire;
  }

  // Cap
  if (agreement.cap_halire !== null && total > agreement.cap_halire) {
    total = agreement.cap_halire;
  }

  return Math.max(0, total);
}

/** Formátuje haléře na Kč s 2 desetinnými místy */
export function formatKc(halire: number): string {
  return `${(halire / 100).toFixed(2)} Kč`;
}
