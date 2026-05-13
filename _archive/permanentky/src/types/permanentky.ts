// =============================================================================
// Permanentky — typy
// Kreditní ledger pro permanentky (EMS / fitness), booking-driven protějšek
// k modulu season-passes.
// =============================================================================

export type PackageType = 'mesicni' | '10lekci' | 'custom';

export type PackageStatus =
  | 'pending_payment'
  | 'active'
  | 'expired'
  | 'depleted'
  | 'refunded';

export interface PackageTemplate {
  id: string;
  promoterId: string;
  /** Display name e.g. "Měsíční permanentka" */
  name: string;
  type: PackageType;
  totalCredits: number;
  validityDays: number;
  priceHalire: number; // INTEGER halíře
  description: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface ClientPackage {
  id: string;
  clientId: string;
  templateId: string;
  promoterId: string;
  totalCredits: number;
  remainingCredits: number;
  status: PackageStatus;
  pricePaidHalire: number;
  /** Stripe/GoPay payment id */
  paymentRef: string | null;
  purchasedAt: Date;
  /** When the package becomes usable (usually = purchasedAt) */
  validFrom: Date;
  /** Expiration */
  validUntil: Date;
  createdAt: Date;
}

export interface PackageUsage {
  id: string;
  packageId: string;
  clientId: string;
  /** Optional reference to ems.reservations(id) */
  reservationId: string | null;
  consumedAt: Date;
  /** If true, this row is a refund (credit added back) */
  isRefund: boolean;
}

export interface PurchasePackageInput {
  templateId: string;
  clientId: string;
  paymentRef?: string;
  /** Override validFrom — defaults to NOW() */
  validFrom?: Date;
}

export interface ConsumeCreditInput {
  packageId: string;
  clientId: string;
  reservationId?: string;
}

export interface PackageBalance {
  clientId: string;
  activePackages: ClientPackage[];
  totalRemainingCredits: number;
  /** Soonest validUntil among active packages */
  nextExpiresAt: Date | null;
}
