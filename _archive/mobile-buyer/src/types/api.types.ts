export interface Event {
  id: string;
  title: string;
  dateStart: string;
  dateEnd?: string;
  venueId: string;
  venueName: string;
  city: string;
  coverImageUrl?: string;
  status: string;
  eventType: string;
  ticketTypes: TicketType[];
}

export interface TicketType {
  id: string;
  name: string;
  description?: string;
  priceCzk: number; // frontend zobrazení — konvertováno z haléřů (÷100)
  available: number;
  maxPerOrder: number;
}

export interface Ticket {
  id: string;
  orderId: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  venueName: string;
  seatInfo: string;
  holderName: string;
  status: 'active' | 'used' | 'revoked' | 'cancelled';
  qrData?: string;
  qrExpiresAt?: string;
}

export interface OrderItem {
  ticketTypeId: string;
  ticketTypeName: string;
  quantity: number;
  unitPriceHellers: number;
  totalHellers: number;
}

export interface Order {
  id: string;
  status: string;
  totalHellers: number;
  currency: string;
  createdAt: string;
  items: OrderItem[];
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  bankIdVerified?: boolean;
}

export interface QrResponse {
  qrData: string;
  expiresAt: string;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
