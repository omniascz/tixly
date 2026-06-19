'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  orderId: string;
  currentStatus: 'pending' | 'ready';
}

export function StatusButton({ orderId, currentStatus }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return null;

  const nextStatus = currentStatus === 'pending' ? 'ready' : 'collected';
  const label =
    currentStatus === 'pending'
      ? 'Označit jako připraveno (staff)'
      : 'Označit jako vydáno (staff)';

  async function handleClick() {
    setLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const r = await fetch(`/api/foyer-orders/${orderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (r.ok) {
        setDone(true);
        window.location.reload();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-3 text-xs"
      disabled={loading}
      onClick={() => void handleClick()}
    >
      {loading ? 'Ukládám…' : label}
    </Button>
  );
}
