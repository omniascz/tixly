'use client';

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card px-6 py-16 text-center">
      <AlertCircle className="mb-3 h-8 w-8 text-rose-600" aria-hidden />
      <h2 className="text-lg font-semibold">Něco se pokazilo</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {error.message || 'Nelze načíst data dashboardu. Zkuste to prosím znovu.'}
      </p>
      <Button onClick={reset} className="mt-4">
        Zkusit znovu
      </Button>
    </div>
  );
}
