export type AbVariant = 'A' | 'B';   // A = 15 min, B = 60 min
export type CartStatus = 'active' | 'abandoned' | 'recovered' | 'converted';

export interface CartItem {
  ticketTypeId: string;
  ticketTypeName: string;
  quantity: number;
  unitPrice: number;   // INTEGER haléře
}

export interface AbandonedCart {
  id: string;
  userId: string;
  eventId: string;
  items: CartItem[];
  totalAmount: number;   // INTEGER haléře
  status: CartStatus;
  abVariant: AbVariant;
  recoveryToken?: string;
  createdAt: Date;
  updatedAt: Date;
  emailSentAt?: Date;
  recoveredAt?: Date;
  convertedAt?: Date;
}

export interface SaveCartRequest {
  eventId: string;
  items: CartItem[];
}

export interface RecoverCartResponse {
  cart: AbandonedCart;
  checkoutUrl: string;
}

// ---------------------------------------------------------------------------
// A/B variant timing (minuty)
// ---------------------------------------------------------------------------
export const AB_DELAY_MINUTES: Record<AbVariant, number> = {
  A: 15,
  B: 60,
};

export class CartNotFoundError extends Error {
  constructor(msg: string) { super(msg); this.name = 'CartNotFoundError'; }
}

export class CartTokenExpiredError extends Error {
  constructor(msg: string) { super(msg); this.name = 'CartTokenExpiredError'; }
}

export class CartAlreadyConvertedError extends Error {
  constructor(msg: string) { super(msg); this.name = 'CartAlreadyConvertedError'; }
}
