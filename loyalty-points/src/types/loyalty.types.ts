// loyalty.types.ts — datové typy pro věrnostní program Tixly.
// Všechny peněžní hodnoty jsou v haléřích (integer). Body jsou celá čísla.

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/**
 * Minimální počet lifetimePoints pro vstup do daného tieru.
 * Tier se počítá z lifetimePoints — nikdy neklesá kvůli expiracím.
 */
export const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  bronze: 0,
  silver: 5_000,
  gold: 20_000,
  platinum: 50_000,
};

/**
 * Multiplikátor pro výpočet bodů z nákupu.
 * Gold 2× → za každou Kč dostane zákazník 2 body.
 */
export const TIER_MULTIPLIERS: Record<LoyaltyTier, number> = {
  bronze: 1,
  silver: 1.5,
  gold: 2,
  platinum: 3,
};

// ---------------------------------------------------------------------------
// Transakce
// ---------------------------------------------------------------------------

export type PointsTransactionType = 'earned' | 'redeemed' | 'expired';

export interface PointsTransaction {
  id: string;
  userId: string;
  type: PointsTransactionType;
  /** Počet bodů — vždy kladné číslo (sémantika určena typem) */
  points: number;
  /** ID objednávky (přítomno u earned/redeemed) */
  orderId?: string;
  description: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Účet
// ---------------------------------------------------------------------------

export interface LoyaltyAccount {
  id: string;
  userId: string;
  /** Aktuální zůstatek bodů (po expiracích a redemptions) */
  totalPoints: number;
  /** Celkový součet všech earned transakcí — nikdy neklesá */
  lifetimePoints: number;
  tier: LoyaltyTier;
  /**
   * Datum expirace bodů.
   * Resetuje se při každém nákupu na now + 12 měsíců.
   * Body expirují pokud zákazník 12 měsíců nic nekoupí.
   */
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

export type RedemptionOption = 'discount' | 'free_ticket';

export interface RedeemResult {
  option: RedemptionOption;
  /** Sleva v haléřích (pro option = 'discount') */
  discountAmount?: number;
  /** True pokud zákazník obdrží volný lístek (pro option = 'free_ticket') */
  freeTicket?: boolean;
  /** Zůstatek bodů po redemption */
  remainingPoints: number;
}

// ---------------------------------------------------------------------------
// Chybové třídy
// ---------------------------------------------------------------------------

export class InsufficientPointsError extends Error {
  constructor(
    public readonly available: number,
    public readonly required: number,
  ) {
    super(`Nedostatek bodů: dostupné ${available}, požadované ${required}.`);
    this.name = 'InsufficientPointsError';
  }
}

export class InvalidRedemptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRedemptionError';
  }
}
