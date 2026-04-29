export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface PermanentkaItem {
  packageId: string;       // ID balíčku permanentky
  packageType: string;     // 'season_pass' | 'multi_entry' | 'flex'
  quantity: number;
  unitPriceHalire: number;
}

export interface CheckoutItem {
  ticketTypeId?: string;
  packageId?: string;      // přítomno → jde o permanentku
  packageType?: string;
  quantity: number;
  unitPriceHalire: number;
}

export interface PermanentkaPackage {
  id: string;
  promoterId: string;
  name: string;
  packageType: string;
  priceHalire: number;
  maxUsages: number;
  status: 'active' | 'sold_out' | 'expired';
}

export interface OrderPackageLink {
  orderId: string;
  packageId: string;
  quantity: number;
  createdAt: string;
}

export interface PurchasePackageResult {
  packageId: string;
  orderId: string;
  reservationId: string;
  status: 'reserved';
}

export interface ActivatePackageResult {
  packageId: string;
  orderId: string;
  activatedAt: string;
  usagesGranted: number;
}
