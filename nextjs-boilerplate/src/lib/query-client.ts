import { QueryClient } from '@tanstack/react-query';
import axios, { AxiosError } from 'axios';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 10,
      retry: (failureCount, error) => {
        const axiosError = error as AxiosError;

        if (!axiosError.response) {
          return failureCount < 3;
        }

        const status = axiosError.response.status;

        if (status === 401 || status === 403 || status === 404) {
          return false;
        }

        if (status >= 500) {
          return failureCount < 3;
        }

        return false;
      },
      retryDelay: (attemptIndex) => {
        return Math.min(1000 * 2 ** attemptIndex, 30000);
      },
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

export const handleQueryError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (error.response?.data?.message) {
      return error.response.data.message;
    }

    if (error.response?.status === 401) {
      return 'Vaše relace vypršela. Prosím přihlaste se znovu.';
    }

    if (error.response?.status === 403) {
      return 'Nemáte oprávnění pro tuto akci.';
    }

    if (error.response?.status === 404) {
      return 'Požadovaný zdroj nebyl nalezen.';
    }

    if (error.response?.status === 422) {
      return 'Validační chyba. Prosím zkontrolujte svá data.';
    }

    if ((error.response?.status ?? 0) >= 500) {
      return 'Chyba serveru. Prosím zkuste to později.';
    }

    if (error.message === 'Network Error') {
      return 'Chyba sítě. Prosím zkontrolujte své připojení.';
    }

    return error.message || 'Došlo k chybě.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Došlo k neznámé chybě.';
};
