export type VendorStatus = 'pending_approval' | 'approved' | 'suspended' | 'rejected';
export type AddonStatus = 'draft' | 'active' | 'sold_out' | 'discontinued';
export type AddonCategory = 'parking' | 'food_beverage' | 'merchandise' | 'accommodation' | 'transport' | 'experience' | 'other';
export type OrderAddonStatus = 'pending' | 'confirmed' | 'cancelled' | 'refunded';

export interface Vendor {
  id: string;
  name: string;
  email: string;
  category: AddonCategory;
  status: VendorStatus;
  commissionRateBps: number;   // basis points, např. 1000 = 10%
  apiKey: string | null;       // pro webhook delivery
  createdAt: Date;
}

export interface Addon {
  id: string;
  vendorId: string;
  eventId: string;
  name: string;
  description: string;
  category: AddonCategory;
  priceCzk: number;            // v haléřích
  maxQuantity: number | null;  // null = unlimited
  soldQuantity: number;
  status: AddonStatus;
  imageUrl: string | null;
  availableFrom: Date | null;
  availableUntil: Date | null;
}

export interface OrderAddon {
  id: string;
  orderId: string;
  addonId: string;
  vendorId: string;
  quantity: number;
  unitPriceCzk: number;
  totalPriceCzk: number;
  commissionCzk: number;        // platform commission
  vendorPayoutCzk: number;      // totalPrice - commission
  status: OrderAddonStatus;
  purchasedAt: Date;
}

export interface VendorInput {
  name: string;
  email: string;
  category: AddonCategory;
  commissionRateBps?: number;   // default 1000 (10%)
}

export interface AddonInput {
  vendorId: string;
  eventId: string;
  name: string;
  description: string;
  category: AddonCategory;
  priceCzk: number;
  maxQuantity?: number;
  availableFrom?: Date;
  availableUntil?: Date;
}

export interface PurchaseAddonInput {
  orderId: string;
  addonId: string;
  quantity: number;
}

export interface VendorPayoutSummary {
  vendorId: string;
  eventId: string;
  totalRevenueCzk: number;
  totalCommissionCzk: number;
  vendorPayoutCzk: number;
  orderCount: number;
}

export class VendorMarketplaceError extends Error {
  constructor(
    public readonly code: 'VENDOR_NOT_FOUND' | 'ADDON_NOT_FOUND' | 'VENDOR_NOT_APPROVED' | 'ADDON_NOT_ACTIVE' | 'INSUFFICIENT_STOCK' | 'ADDON_NOT_AVAILABLE' | 'ORDER_ADDON_NOT_FOUND',
    message: string
  ) { super(message); this.name = 'VendorMarketplaceError'; }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps { db: DbAdapter; now?: () => Date; }
