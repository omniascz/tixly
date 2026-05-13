export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export type PlanType = 'split_3' | 'split_6' | 'split_12';  // počet splátek

export interface PaymentPlan {
  id: string;
  ticketTypeId: string;
  promoterId: string;
  planType: PlanType;
  enabled: boolean;
  downPaymentPercent: number;  // % jako první splátka (default 33%)
  issueTicketAfter: 'first_payment' | 'full_payment';
}

export interface TicketInstallment {
  id: string;
  planId: string;
  orderId: string;
  ticketId?: string;           // vyplní se pokud issueTicketAfter='first_payment'
  planType: PlanType;
  totalAmountHalire: number;
  paidAmountHalire: number;
  remainingHalire: number;
  installments: InstallmentSchedule[];
  status: 'active' | 'completed' | 'defaulted' | 'cancelled';
  nextPaymentAt: string;
  createdAt: string;
}

export interface InstallmentSchedule {
  number: number;              // 1, 2, 3...
  amountHalire: number;
  dueAt: string;
  paidAt?: string;
  status: 'pending' | 'paid' | 'overdue';
}
