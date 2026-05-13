export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface AgeVerification {
  id: string;
  orderId: string;
  userId: string;
  promoterId: string;
  verifiedAt: string;
  method: 'self_declared' | 'bankid';
  ageAtVerification: number;
}

export interface AgeVerificationRequest {
  orderId: string;
  birthDate: string;
  method?: 'self_declared' | 'bankid';
}

export interface AgeRows {
  id: string;
  order_id: string;
  user_id: string;
  promoter_id: string;
  verified_at: string;
  method: string;
  age_at_verification: number;
  created_at: string;
  updated_at: string;
}

export interface ValidateResult {
  isValid: boolean;
  ageYears: number;
}
