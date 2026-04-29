import { useQuery as useReactQuery, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { handleQueryError } from '@/lib/query-client';

export function useQuery<TData = unknown, TError = AxiosError>(
  options: UseQueryOptions<TData, TError>
): UseQueryResult<TData, TError> {
  return useReactQuery<TData, TError>(options);
}

export function useErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return handleQueryError(error);
  }
  return 'Došlo k neznámé chybě.';
}
