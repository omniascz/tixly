export type PromoCodeType = 'percentage' | 'fixed' | 'bogo' | 'free';

export interface PromoCode {
  id: string;
  code: string; // always uppercase
  type: PromoCodeType;
  discount_value: number; // percentage: 0-100, fixed: haléře, bogo/free: 0
  max_uses: number | null;
  max_uses_per_user: number | null;
  uses_count: number;
  valid_from: Date;
  valid_until: Date | null;
  min_quantity: number;
  min_order_amount: number; // haléře
  applicable_ticket_type_ids: string[] | null;
  applicable_event_ids: string[] | null;
  stackable: boolean;
  active: boolean;
  created_by_organizer_id: string;
  created_at: Date;
}

export interface OrderItem {
  ticket_type_id: string;
  event_id: string;
  quantity: number;
  unit_price: number; // haléře
}

export interface ApplyPromoCodeRequest {
  code: string;
  order_items: OrderItem[];
  user_id: string;
}

export interface AppliedItem {
  ticket_type_id: string;
  original: number; // haléře
  discounted: number; // haléře
}

export interface ApplyPromoCodeResult {
  promo_code_id: string;
  code: string;
  discount_type: string;
  original_total: number; // haléře
  discount_amount: number; // haléře
  final_total: number; // haléře
  applied_to_items: AppliedItem[];
  message: string;
}

// ─── Typed error hierarchy ──────────────────────────────────────────────────

export class PromoCodeValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PromoCodeValidationError';
  }
}

export class PromoCodeNotFoundError extends PromoCodeValidationError {
  constructor(code: string) {
    super(`Promo kód „${code}" nenalezen`, code);
    this.name = 'PromoCodeNotFoundError';
  }
}

export class PromoCodeExpiredError extends PromoCodeValidationError {
  constructor(code: string) {
    super('Platnost promo kódu vypršela', code);
    this.name = 'PromoCodeExpiredError';
  }
}

export class PromoCodeNotYetValidError extends PromoCodeValidationError {
  constructor(code: string) {
    super('Promo kód ještě není platný', code);
    this.name = 'PromoCodeNotYetValidError';
  }
}

export class PromoCodeMaxUsesError extends PromoCodeValidationError {
  constructor(code: string) {
    super('Promo kód dosáhl maximálního počtu použití', code);
    this.name = 'PromoCodeMaxUsesError';
  }
}

export class PromoCodeMaxUsesPerUserError extends PromoCodeValidationError {
  constructor(code: string) {
    super('Překročen limit použití tohoto kódu pro váš účet', code);
    this.name = 'PromoCodeMaxUsesPerUserError';
  }
}

export class PromoCodeInactiveError extends PromoCodeValidationError {
  constructor(code: string) {
    super('Promo kód není aktivní', code);
    this.name = 'PromoCodeInactiveError';
  }
}

export class PromoCodeNotApplicableError extends PromoCodeValidationError {
  constructor(code: string, reason: string) {
    super(reason, code);
    this.name = 'PromoCodeNotApplicableError';
  }
}

export class PromoCodeMinimumNotMetError extends PromoCodeValidationError {
  constructor(
    code: string,
    public readonly minQuantity: number,
    public readonly minOrderAmount: number,
  ) {
    super('Nesplněny minimální podmínky pro uplatnění kódu', code);
    this.name = 'PromoCodeMinimumNotMetError';
  }
}
