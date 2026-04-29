export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  price: number;
  currency: 'CZK' | 'EUR' | 'USD';
  quantity: number;
  quantitySold: number;
  quantityAvailable: number;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  startDate: string;
  endDate: string;
  location: string;
  organizerId: string;
  ticketTypes: TicketType[];
  totalTickets: number;
  ticketsSold: number;
  status: 'draft' | 'published' | 'cancelled' | 'ended';
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  eventId: string;
  ticketTypeId: string;
  orderId: string;
  userId: string;
  qrCode: string;
  qrCodeUrl: string;
  scanned: boolean;
  scannedAt?: string;
  scannedBy?: string;
  resalable: boolean;
  resaleListingId?: string;
  status: 'active' | 'used' | 'transferred' | 'refunded';
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  userId: string;
  eventId: string;
  tickets: Ticket[];
  totalPrice: number;
  currency: 'CZK' | 'EUR' | 'USD';
  paymentMethod: 'gopay' | 'card' | 'bank_transfer';
  paymentId?: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  status: 'pending' | 'confirmed' | 'cancelled' | 'refunded';
  createdAt: string;
  updatedAt: string;
}

export interface ResaleListing {
  id: string;
  ticketId: string;
  sellerId: string;
  price: number;
  currency: 'CZK' | 'EUR' | 'USD';
  description?: string;
  status: 'active' | 'sold' | 'cancelled';
  buyerId?: string;
  transactionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface GoPayPaymentConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  returnUrl: string;
}

export interface QRCodeData {
  ticketId: string;
  eventId: string;
  userId: string;
  timestamp: number;
  signature: string;
}
