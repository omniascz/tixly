export type WalletStatus = 'active' | 'frozen' | 'closed';
export type TransactionType = 'top_up' | 'purchase' | 'refund' | 'adjustment';
export type VendorCategory = 'food_beverage' | 'merchandise' | 'parking' | 'other';

export interface CashlessWallet {
  id: string;
  eventId: string;
  attendeeId: string;           // user ID nebo anonymní ID z RFID
  rfidUid: string;              // UID RFID čipu
  balanceCzk: number;           // v haléřích
  status: WalletStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CashlessTransaction {
  id: string;
  walletId: string;
  vendorId: string | null;
  type: TransactionType;
  amountCzk: number;            // v haléřích, kladné i záporné
  balanceAfterCzk: number;
  description: string;
  terminalId: string | null;
  occurredAt: Date;
}

export interface Vendor {
  id: string;
  eventId: string;
  name: string;
  category: VendorCategory;
  terminalIds: string[];
  isActive: boolean;
}

export interface TopUpInput {
  rfidUid: string;
  eventId: string;
  amountCzk: number;
  description?: string;
}

export interface PurchaseInput {
  rfidUid: string;
  eventId: string;
  vendorId: string;
  terminalId: string;
  amountCzk: number;
  description: string;
}

export interface EventCashlessStats {
  eventId: string;
  totalWallets: number;
  totalTopUpCzk: number;
  totalSpentCzk: number;
  totalUnspentCzk: number;       // peníze k vrácení
  topVendors: Array<{ vendorId: string; name: string; revenueCzk: number }>;
  averageSpendPerAttendee: number;
}

export class CashlessError extends Error {
  constructor(
    public readonly code: 'WALLET_NOT_FOUND' | 'INSUFFICIENT_BALANCE' | 'WALLET_FROZEN' | 'VENDOR_NOT_FOUND' | 'INVALID_AMOUNT' | 'RFID_NOT_REGISTERED',
    message: string
  ) { super(message); this.name = 'CashlessError'; }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps { db: DbAdapter; }
