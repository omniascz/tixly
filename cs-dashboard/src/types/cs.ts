export interface CsSearchResult {
  users: Array<{ userId: string; email: string; name: string; phone: string | null; orderCount: number }>;
  orders: Array<{ orderId: string; orderNumber: string; buyerEmail: string; eventName: string; totalHalire: number; status: string }>;
}

export interface CsOrderDetail {
  order: { id: string; orderNumber: string; status: string; totalHalire: number; createdAt: Date; paidAt: Date | null };
  buyer: { userId: string; email: string; name: string; phone: string | null };
  event: { id: string; name: string; startDate: Date; venueName: string | null };
  tickets: Array<{ ticketId: string; typeName: string; status: string; barcodeCode: string; holderName: string }>;
  payments: Array<{ id: string; provider: string; status: string; amountHalire: number }>;
  refunds: Array<{ id: string; amountHalire: number; status: string; reason: string; createdAt: Date }>;
}

export interface CsAction {
  type: 'refund' | 'reissue_ticket' | 'cancel_order' | 'blacklist' | 'unblacklist' | 'note';
  description: string;
}
