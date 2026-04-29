// Ambassador Management — typy a chybové třídy
// Všechny peněžní hodnoty jsou v INTEGER haléřích.

export type AmbassadorTier = 'bronze' | 'silver' | 'gold';
export type AmbassadorStatus = 'active' | 'suspended';

export interface Ambassador {
  id: string;
  userId: string;
  promoterId: string;
  name: string;
  /** Úroveň ambassadora */
  tier: AmbassadorTier;
  /** Sazba provize v basis points — celé číslo 0–3000 (0–30 %) */
  commissionRateBps: number;
  /** Zůstatek peněženky v haléřích — celé číslo */
  walletBalance: number;
  status: AmbassadorStatus;
  createdAt: Date;
}

export interface AmbassadorCode {
  id: string;
  ambassadorId: string;
  /** Promo kód, 8 znaků [A-Z2-9] */
  code: string;
  maxUses: number;
  usedCount: number;
  /** Sleva pro fanouška v basis points — celé číslo 0–5000 (0–50 %) */
  discountBps: number;
  validUntil: Date;
  createdAt: Date;
}

export interface AmbassadorStats {
  ambassadorId: string;
  /** Celkový objem prodejů v haléřích */
  totalSales: number;
  /** Celková provize v haléřích */
  totalCommission: number;
  /** Počet použití kódů */
  codesUsed: number;
  /** Míra konverze (0–100) */
  conversionRate: number;
}

// ---------------------------------------------------------------------------
// Chybové třídy
// ---------------------------------------------------------------------------

export class AmbassadorNotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AmbassadorNotFoundError';
  }
}

export class CodeExhaustedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CodeExhaustedError';
  }
}

export class AmbassadorSuspendedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AmbassadorSuspendedError';
  }
}
