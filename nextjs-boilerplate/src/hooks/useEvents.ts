import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Event, PaginatedResponse, PaginationQuery } from '@/types/index';

const EVENTS_QUERY_KEY = ['events'];

export const useEvents = (pagination?: PaginationQuery) => {
  return useQuery({
    queryKey: [...EVENTS_QUERY_KEY, pagination],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Event>>('/api/events', {
        params: pagination,
      });
      return response.data;
    },
  });
};

export const useEvent = (eventId: string) => {
  return useQuery({
    queryKey: [...EVENTS_QUERY_KEY, eventId],
    queryFn: async () => {
      const response = await api.get<{ data: Event }>(`/api/events/${eventId}`);
      return response.data.data;
    },
  });
};

interface CreateEventInput {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string;
  imageUrl?: string;
}

export const useCreateEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateEventInput) => {
      const response = await api.post<{ data: Event }>('/api/events', data);
      return response.data.data;
    },
    onSuccess: (newEvent) => {
      queryClient.invalidateQueries({
        queryKey: EVENTS_QUERY_KEY,
      });
      queryClient.setQueryData([...EVENTS_QUERY_KEY, newEvent.id], newEvent);
    },
  });
};

interface UpdateEventInput {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  imageUrl?: string;
  status?: 'draft' | 'published' | 'cancelled' | 'ended';
}

export const useUpdateEvent = (eventId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateEventInput) => {
      const response = await api.put<{ data: Event }>(`/api/events/${eventId}`, data);
      return response.data.data;
    },
    onSuccess: (updatedEvent) => {
      queryClient.invalidateQueries({
        queryKey: EVENTS_QUERY_KEY,
      });
      queryClient.setQueryData([...EVENTS_QUERY_KEY, eventId], updatedEvent);
    },
  });
};

export const useDeleteEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eventId: string) => {
      await api.delete(`/api/events/${eventId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: EVENTS_QUERY_KEY,
      });
    },
  });
};
