export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface FnbMenuItem {
  id: string;
  promoterId: string;
  eventId?: string;       // null = dostupné pro všechny eventy promotéra
  name: string;
  description?: string;
  category: 'food' | 'beverage' | 'combo' | 'other';
  priceHalire: number;
  maxQuantityPerOrder: number;
  stockLimit?: number;    // null = neomezeno
  available: boolean;
  imageUrl?: string;
}

export interface FnbOrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceHalire: number;
  subtotalHalire: number;
}

export interface FnbPreorder {
  id: string;
  orderId: string;         // propojení s ticket order
  eventId: string;
  promoterId: string;
  userId?: string;
  items: FnbOrderItem[];
  totalHalire: number;
  status: 'pending' | 'confirmed' | 'ready' | 'picked_up' | 'cancelled';
  pickupCode: string;      // 6-místný kód pro výdej
  pickupQrData: string;    // data pro QR kód (pickupCode + orderId hash)
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
  createdAt: string;
}
