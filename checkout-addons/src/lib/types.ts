export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export type AddonCategory = 'parking' | 'merch' | 'insurance' | 'upgrade' | 'other';

export interface CheckoutAddon {
  id: string;
  promoterId: string;
  eventId?: string;
  name: string;
  description?: string;
  category: AddonCategory;
  priceHalire: number;
  maxQuantity: number;
  stockAvailable?: number;
  imageUrl?: string;
  available: boolean;
  displayOrder: number;
}

export interface OrderAddon {
  id: string;
  orderId: string;
  addonId: string;
  addonName: string;
  category: AddonCategory;
  quantity: number;
  unitPriceHalire: number;
  subtotalHalire: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface AddonCartItem {
  addonId: string;
  quantity: number;
}
