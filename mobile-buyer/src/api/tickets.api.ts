import { apiClient } from './client';
import type { Ticket, QrResponse } from '../types/api.types';

export const ticketsApi = {
  listMine(): Promise<Ticket[]> {
    return apiClient.get<Ticket[]>('/api/tickets/mine');
  },

  getById(ticketId: string): Promise<Ticket> {
    return apiClient.get<Ticket>(`/api/tickets/${ticketId}`);
  },

  getQr(ticketId: string): Promise<QrResponse> {
    return apiClient.get<QrResponse>(`/api/tickets/${ticketId}/qr`);
  },

  getWalletPass(ticketId: string, type: 'apple' | 'google'): Promise<{ url: string }> {
    return apiClient.get<{ url: string }>(`/api/tickets/${ticketId}/wallet?type=${type}`);
  },
};
