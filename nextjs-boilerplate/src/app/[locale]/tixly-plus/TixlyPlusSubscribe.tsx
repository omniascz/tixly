'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function TixlyPlusSubscribe({ planId, locale }: { planId: string; locale: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/subscriptions/subscribe', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          planId,
          ...(token ? {} : { buyerEmail: email, buyerName: name }),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        subscriptionId?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/${locale}/my-tickets`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isLoggedIn = typeof window !== 'undefined' && !!localStorage.getItem('accessToken');

  return (
    <div className="space-y-2">
      {!isLoggedIn ? (
        <>
          <Input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder="Jméno"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </>
      ) : null}
      <Button
        size="sm"
        onClick={subscribe}
        disabled={busy || (!isLoggedIn && (!email || !name))}
        className="w-full"
      >
        {busy ? 'Přihlašuji…' : 'Předplatit'}
      </Button>
      {error ? (
        <p className="rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}
