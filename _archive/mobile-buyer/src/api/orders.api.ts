import { apiClient } from './client';
import type { Order } from '../types/api.types';

export interface CreateOrderPayload {
  eventId: string;
  items: Array<{
    ticketTypeId: string;
    quantity: number;
  }>;
}

export interface StripeCheckoutResponse {
  clientSecret: string;
  publishableKey: string;
}

export interface GoPayCheckoutResponse {
  gatewayUrl: string;
  orderId: string;
}

export const ordersApi = {
  create(payload: CreateOrderPayload): Promise<Order> {
    return apiClient.post<Order>('/api/orders', payload);
  },

  getById(orderId: string): Promise<Order> {
    return apiClient.get<Order>(`/api/orders/${orderId}`);
  },

  listMine(): Promise<Order[]> {
    return apiClient.get<Order[]>('/api/orders/mine');
  },

  initiateStripe(orderId: string): Promise<StripeCheckoutResponse> {
    return apiClient.post<StripeCheckoutResponse>(`/api/payments/stripe/checkout`, { orderId });
  },

  initiateGoPay(orderId: string): Promise<GoPayCheckoutResponse> {
    return apiClient.post<GoPayCheckoutResponse>(`/api/payments/gopay/checkout`, { orderId });
  },
};
