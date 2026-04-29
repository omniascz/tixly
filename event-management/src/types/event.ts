export type EventStatus = 'draft' | 'published' | 'cancelled' | 'ended' | 'sold_out';

export interface Event {
  id: string;
  promoterId: string;
  venueId: string | null;
  title: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  imageUrl: string | null;
  startDate: Date;
  endDate: Date | null;
  status: EventStatus;
  capacity: number | null;          // null = unlimited
  soldCount: number;
  onSaleAt: Date | null;            // when tickets go on sale
  offSaleAt: Date | null;           // when ticket sales close
  resaleAllowed: boolean;
  resaleCommissionRate: number | null;  // basis points
  reEntryAllowed: boolean;
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  priceHalire: number;          // INTEGER halíře
  capacity: number | null;      // null = shares event capacity
  soldCount: number;
  zone: string | null;
  sortOrder: number;
  saleStartAt: Date | null;
  saleEndAt: Date | null;
  minPerOrder: number;
  maxPerOrder: number;
  isActive: boolean;
  transferable: boolean;
  createdAt: Date;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  category?: string;
  subcategory?: string;
  imageUrl?: string;
  venueId?: string;
  startDate: string;            // ISO datetime
  endDate?: string;
  capacity?: number;
  onSaleAt?: string;
  offSaleAt?: string;
  resaleAllowed?: boolean;
  reEntryAllowed?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
  ticketTypes: CreateTicketTypeInput[];
}

export interface CreateTicketTypeInput {
  name: string;
  description?: string;
  priceHalire: number;
  capacity?: number;
  zone?: string;
  sortOrder?: number;
  saleStartAt?: string;
  saleEndAt?: string;
  minPerOrder?: number;
  maxPerOrder?: number;
  transferable?: boolean;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  imageUrl?: string | null;
  venueId?: string | null;
  startDate?: string;
  endDate?: string | null;
  capacity?: number | null;
  onSaleAt?: string | null;
  offSaleAt?: string | null;
  resaleAllowed?: boolean;
  reEntryAllowed?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}

export interface UpdateTicketTypeInput {
  name?: string;
  description?: string | null;
  priceHalire?: number;
  capacity?: number | null;
  zone?: string | null;
  sortOrder?: number;
  saleStartAt?: string | null;
  saleEndAt?: string | null;
  minPerOrder?: number;
  maxPerOrder?: number;
  isActive?: boolean;
  transferable?: boolean;
}

export interface EventWithTicketTypes extends Event {
  ticketTypes: TicketType[];
  /** Computed: total sold across all ticket types */
  totalSold: number;
  /** Computed: total remaining */
  totalRemaining: number | null;
}

export interface EventListItem {
  id: string;
  title: string;
  startDate: Date;
  status: EventStatus;
  capacity: number | null;
  soldCount: number;
  ticketTypeCount: number;
  imageUrl: string | null;
  venueName: string | null;
}
