'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { ReactNode } from 'react';
import { queryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
