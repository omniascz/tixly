import {
  useMutation as useReactMutation,
  UseMutationOptions,
  UseMutationResult,
} from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { handleQueryError } from '@/lib/query-client';

export function useMutation<
  TData = unknown,
  TError = AxiosError,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>
): UseMutationResult<TData, TError, TVariables, TContext> {
  return useReactMutation<TData, TError, TVariables, TContext>(options);
}

export function useErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return handleQueryError(error);
  }
  return 'Došlo k neznámé chybě.';
}
