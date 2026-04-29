'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  promoterId?: string;
  source?: string;
  className?: string;
}

export function NewsletterWidget({ promoterId, source, className }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: name || undefined,
          promoterId,
          source,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        existing?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={`rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 ${className ?? ''}`}>
        Skvěle! Pošli ti potvrzovací e-mail — klikni na odkaz pro dokončení přihlášení.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`space-y-2 ${className ?? ''}`}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="flex-1"
        />
        <Input
          placeholder="Jméno (volitelné)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={busy || !email}>
          {busy ? '...' : 'Odebírat'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Posíláme novinky o akcích. Odhlásit můžeš kdykoliv.
      </p>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </form>
  );
}
