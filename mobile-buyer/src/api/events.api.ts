import { apiClient } from './client';
import type { Event, PaginatedResponse } from '../types/api.types';

export interface EventListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  city?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const eventsApi = {
  list(params: EventListParams = {}): Promise<PaginatedResponse<Event>> {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
    if (params.search) query.set('search', params.search);
    if (params.category) query.set('category', params.category);
    if (params.city) query.set('city', params.city);
    if (params.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params.dateTo) query.set('dateTo', params.dateTo);
    const qs = query.toString();
    return apiClient.get<PaginatedResponse<Event>>(`/api/events${qs ? `?${qs}` : ''}`);
  },

  getById(eventId: string): Promise<Event> {
    return apiClient.get<Event>(`/api/events/${eventId}`);
  },
};
