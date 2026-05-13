'use client';

/**
 * Follow button — subscribe na newsletter konkrétního promotéra.
 *
 * Pro anonymního visitora: input pro email + double-opt-in flow.
 * Pro přihlášeného: jeden klik, použije se email z accountu.
 *
 * Backend: POST /api/newsletter/subscribe { email, promoterId }.
 */

import { useState } from 'react';
import { Bell, BellRing, Check } from 'lucide-react';

export function FollowButton({
  promoterId,
  promoterName,
}: {
  promoterId: string;
  promoterName: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe(emailValue: string) {
    setBusy(true);
    setError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: emailValue, promoterId, source: 'p_slug_page' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Přihlášení selhalo');
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  function handleClick() {
    // Pokud jsi přihlášen, použij email z accountu
    if (typeof window !== 'undefined') {
      const userRaw = localStorage.getItem('user');
      if (userRaw) {
        try {
          const user = JSON.parse(userRaw) as { email?: string };
          if (user.email) {
            void subscribe(user.email);
            return;
          }
        } catch {
          // ignore
        }
      }
    }
    setOpen(true);
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-white/95 px-3 py-2 text-sm text-emerald-900">
        <Check className="h-4 w-4" aria-hidden />
        <span className="font-medium">Zkontroluj e-mail (potvrzovací odkaz)</span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="flex items-center gap-2 rounded-md bg-white/95 px-4 py-2 text-sm font-medium text-foreground hover:bg-white disabled:opacity-60"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {busy ? 'Přihlašuji…' : 'Sledovat'}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email) void subscribe(email);
      }}
      className="flex max-w-xs flex-col gap-2 rounded-md bg-white/95 p-3"
    >
      <p className="text-xs font-medium">
        <BellRing className="mr-1 inline h-3 w-3" aria-hidden />
        Sledovat <strong>{promoterName}</strong>
      </p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tvuj@email.cz"
        className="rounded-md border bg-background px-3 py-1.5 text-sm"
      />
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      <button
        type="submit"
        disabled={busy || !email}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {busy ? 'Posílám…' : 'Přihlásit k odběru'}
      </button>
      <p className="text-[10px] text-muted-foreground">
        Pošleme ti potvrzovací mail. Odhlásíš se kdykoliv jedním klikem.
      </p>
    </form>
  );
}
