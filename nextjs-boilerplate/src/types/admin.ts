export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'refunded'
  | 'expired';

export type ModerationStatus =
  | 'draft'
  | 'pending_review'
  | 'flagged'
  | 'published'
  | 'rejected'
  | 'archived'
  | 'cancelled';

export interface AdminEvent {
  id: string;
  name: string;
  date: string;
  moderationStatus?: ModerationStatus;
  rejectionReason?: string | null;
}

export interface AdminEventDetail extends AdminEvent {
  status?: 'draft' | 'on_sale' | 'sold_out' | 'past';
  capacity?: number;
  sold?: number;
  revenueHalire?: number;
}

export interface AdminOrder {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  eventId: string;
  eventName: string;
  totalHalire: number;
  currency?: string;
  ticketCount: number;
  ticketSummary: string;
  status: OrderStatus;
  paidAt: string | null;
}

export interface AdminOrdersResponse {
  items: AdminOrder[];
  total: number;
  totalRevenueHalire: number;
  primaryCurrency?: string;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminOrderFilters {
  eventId?: string;
  status?: OrderStatus;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface AdminCustomer {
  email: string;
  name: string;
  phone: string | null;
  ordersCount: number;
  totalSpentHalire: number;
  lastOrderAt: string;
}

export interface AdminPayout {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossHalire: number;
  feesHalire: number;
  netHalire: number;
  /** 'estimate' = dopočtené období, ne výplata (kolo 7, C-57). */
  status: 'estimate' | 'pending' | 'approved' | 'processing' | 'awaiting_manual_transfer' | 'paid' | 'failed' | 'cancelled';
  paidAt: string | null;
  bankReference?: string | null;
  transferDate?: string | null;
}

export interface AdminPayoutsOverview {
  source: 'real' | 'computed';
  payoutIban: string | null;
  payouts: AdminPayout[];
}
