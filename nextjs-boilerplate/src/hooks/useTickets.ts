import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Ticket, PaginatedResponse, PaginationQuery } from '@/types/index';

const TICKETS_QUERY_KEY = ['tickets'];

export const useTickets = (pagination?: PaginationQuery) => {
  return useQuery({
    queryKey: [...TICKETS_QUERY_KEY, pagination],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Ticket>>('/api/tickets', {
        params: pagination,
      });
      return response.data;
    },
  });
};

export const useUserTickets = (userId: string, pagination?: PaginationQuery) => {
  return useQuery({
    queryKey: [...TICKETS_QUERY_KEY, 'user', userId, pagination],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Ticket>>(
        `/api/users/${userId}/tickets`,
        {
          params: pagination,
        }
      );
      return response.data;
    },
  });
};

export const useTicket = (ticketId: string) => {
  return useQuery({
    queryKey: [...TICKETS_QUERY_KEY, ticketId],
    queryFn: async () => {
      const response = await api.get<{ data: Ticket }>(`/api/tickets/${ticketId}`);
      return response.data.data;
    },
  });
};

interface TransferTicketInput {
  recipientEmail: string;
}

export const useTransferTicket = (ticketId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TransferTicketInput) => {
      const response = await api.post<{ data: Ticket }>(
        `/api/tickets/${ticketId}/transfer`,
        data
      );
      return response.data.data;
    },
    onSuccess: (updatedTicket) => {
      queryClient.invalidateQueries({
        queryKey: TICKETS_QUERY_KEY,
      });
      queryClient.setQueryData([...TICKETS_QUERY_KEY, ticketId], updatedTicket);
    },
  });
};

interface ScanTicketInput {
  qrData: string;
}

export const useScanTicket = (ticketId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ScanTicketInput) => {
      const response = await api.post<{ data: Ticket }>(`/api/tickets/${ticketId}/scan`, data);
      return response.data.data;
    },
    onSuccess: (scannedTicket) => {
      queryClient.setQueryData([...TICKETS_QUERY_KEY, ticketId], scannedTicket);
    },
  });
};
