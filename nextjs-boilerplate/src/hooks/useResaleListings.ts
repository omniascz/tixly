import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { ResaleListing, PaginatedResponse, PaginationQuery } from '@/types/index';

const RESALE_QUERY_KEY = ['resaleListings'];

export const useResaleListings = (pagination?: PaginationQuery) => {
  return useQuery({
    queryKey: [...RESALE_QUERY_KEY, pagination],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<ResaleListing>>('/api/resale', {
        params: pagination,
      });
      return response.data;
    },
  });
};

export const useUserResaleListings = (userId: string, pagination?: PaginationQuery) => {
  return useQuery({
    queryKey: [...RESALE_QUERY_KEY, 'user', userId, pagination],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<ResaleListing>>(
        `/api/users/${userId}/resale-listings`,
        {
          params: pagination,
        }
      );
      return response.data;
    },
  });
};

export const useResaleListing = (listingId: string) => {
  return useQuery({
    queryKey: [...RESALE_QUERY_KEY, listingId],
    queryFn: async () => {
      const response = await api.get<{ data: ResaleListing }>(`/api/resale/${listingId}`);
      return response.data.data;
    },
  });
};

interface CreateResaleListingInput {
  ticketId: string;
  price: number;
  currency: 'CZK' | 'EUR' | 'USD';
  description?: string;
}

export const useCreateResaleListing = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateResaleListingInput) => {
      const response = await api.post<{ data: ResaleListing }>('/api/resale', data);
      return response.data.data;
    },
    onSuccess: (newListing) => {
      queryClient.invalidateQueries({
        queryKey: RESALE_QUERY_KEY,
      });
      queryClient.setQueryData([...RESALE_QUERY_KEY, newListing.id], newListing);
    },
  });
};

interface UpdateResaleListingInput {
  price?: number;
  description?: string;
}

export const useUpdateResaleListing = (listingId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateResaleListingInput) => {
      const response = await api.put<{ data: ResaleListing }>(`/api/resale/${listingId}`, data);
      return response.data.data;
    },
    onSuccess: (updatedListing) => {
      queryClient.invalidateQueries({
        queryKey: RESALE_QUERY_KEY,
      });
      queryClient.setQueryData([...RESALE_QUERY_KEY, listingId], updatedListing);
    },
  });
};

export const useDeleteResaleListing = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listingId: string) => {
      await api.delete(`/api/resale/${listingId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: RESALE_QUERY_KEY,
      });
    },
  });
};

interface PurchaseResaleListingInput {
  listingId: string;
}

export const usePurchaseResaleListing = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: PurchaseResaleListingInput) => {
      const response = await api.post<{ data: ResaleListing }>(
        `/api/resale/${data.listingId}/purchase`
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: RESALE_QUERY_KEY,
      });
    },
  });
};
