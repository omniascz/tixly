'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function TeamAcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCreds, setNeedsCreds] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/team/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          ...(needsCreds ? { password, name } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        accessToken?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok) {
        if (j.error === 'NEW_USER_REQUIRES_PASSWORD_NAME') {
          setNeedsCreds(true);
          setError('Pro tento e-mail neexistuje účet — vyplň heslo a jméno.');
          return;
        }
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      if (j.accessToken) {
        localStorage.setItem('accessToken', j.accessToken);
      }
      setDone(true);
      setTimeout(() => router.push('/admin/events'), 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        Pozvánka přijata. Přesměrovávám…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {needsCreds ? (
        <>
          <Input
            placeholder="Tvoje jméno"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Nové heslo (8+ znaků)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      ) : null}
      <Button
        onClick={accept}
        disabled={busy || (needsCreds && (!password || !name))}
        className="w-full"
      >
        {busy ? 'Přijímám…' : 'Přijmout pozvánku'}
      </Button>
    </div>
  );
}
