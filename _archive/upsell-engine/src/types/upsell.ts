export type UpsellType =
  | 'insurance'
  | 'vip_upgrade'
  | 'meet_greet'
  | 'parking'
  | 'fnb_voucher'
  | 'merchandise'
  | 'camping_pass'
  | 'locker'
  | 'travel_package'
  | 'livestream';

export type UpsellTiming = 'checkout' | 'post_purchase' | 'pre_event' | 'on_site';
export type UpsellStatus = 'active' | 'paused' | 'archived';
export type UpsellOrderStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';

export interface UpsellItemPublic {
  id: string;
  type: UpsellType;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  imageUrl: string | null;
  metadata: Record<string, unknown>;
  remainingQty: number | null;
  isLowStock: boolean;
}

export interface UpsellItemOrganizer extends UpsellItemPublic {
  status: UpsellStatus;
  platformFeePct: number;
  totalQty: number | null;
  soldCount: number;
  reservedCount: number;
  rules: UpsellRulePublic[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsellRulePublic {
  id: string;
  ticketTypeId: string | null;
  timing: UpsellTiming;
  sortOrder: number;
  maxPerOrder: number | null;
  availableFrom: string | null;
  availableUntil: string | null;
  exclusiveToTicketTypes: string[];
  isActive: boolean;
}

export interface UpsellInventoryRow {
  upsell_item_id: string;
  total_qty: number | null;
  sold_count: number;
  reserved_count: number;
  low_threshold: number;
  updated_at: string;
}

export interface UpsellItemRow {
  id: string;
  event_id: string;
  type: UpsellType;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  platform_fee_pct: number;
  image_url: string | null;
  metadata: Record<string, unknown>;
  status: UpsellStatus;
  created_at: string;
  updated_at: string;
}

export interface UpsellRuleRow {
  id: string;
  upsell_item_id: string;
  ticket_type_id: string | null;
  timing: UpsellTiming;
  sort_order: number;
  max_per_order: number | null;
  available_from: string | null;
  available_until: string | null;
  exclusive_to_ticket_types: string[];
  conditions: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface UpsellOrderItemRow {
  id: string;
  order_id: string;
  ticket_id: string | null;
  upsell_item_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  platform_fee_pct: number;
  platform_fee_amt: number;
  organizer_payout: number;
  status: UpsellOrderStatus;
  idempotency_key: string;
  variant_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsellAnalyticsRow {
  id: string;
  upsell_item_id: string;
  event_type: string;
  user_id: string | null;
  order_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface KafkaUpsellPurchasedEvent {
  eventType: 'upsell.purchased';
  orderId: string;
  ticketId: string | null;
  upsellItemId: string;
  upsellType: UpsellType;
  userId: string;
  eventId: string;
  quantity: number;
  totalPrice: number;
  timestamp: string;
}

export interface KafkaUpsellInventoryLowEvent {
  eventType: 'upsell.inventory.low';
  upsellItemId: string;
  eventId: string;
  remaining: number;
}
