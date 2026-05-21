'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Attendee {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function AttendeeEditClient({ ticketId, locale }: { ticketId: string; locale: string }): JSX.Element {
  const [data, setData] = useState<Attendee | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch(`/api/buyer/tickets/${ticketId}/attendee`)
      .then((r) => r.json())
      .then((d: { attendee: Attendee | null }) => {
        if (d.attendee) {
          setData(d.attendee);
          setFirstName(d.attendee.first_name ?? '');
          setLastName(d.attendee.last_name ?? '');
          setEmail(d.attendee.email ?? '');
          setPhone(d.attendee.phone ?? '');
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Chyba'));
  }, [ticketId]);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await authFetch(`/api/buyer/tickets/${ticketId}/attendee`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          email: email || undefined,
          phone: phone || undefined,
        }),
      });
      if (!r.ok) {
        const e = await r.json() as { error?: string };
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link
        href={`/${locale}/my-tickets`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-3 w-3" /> Zpět na moje lístky
      </Link>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}

      {saved ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <Check className="h-4 w-4" /> Uloženo. Nové údaje uvidí pořadatel u brány.
        </div>
      ) : null}

      <div className="space-y-3 rounded-md border bg-card p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Jméno</label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={100} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Příjmení</label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">E-mail</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Telefon (volitelně)</label>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="+420…" />
        </div>
        <Button onClick={save} disabled={busy} className="w-full">
          {busy ? 'Ukládám…' : 'Uložit změny'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Změna údajů nemění vlastnictví lístku. Pokud chceš lístek převést na jinou osobu, použij
        funkci „Přeposlat na e-mail" v seznamu lístků.
      </p>

      {data === null ? (
        <p className="text-xs text-muted-foreground">
          Údaje zatím nejsou nastavené — používáme jméno a e-mail z tvé objednávky.
        </p>
      ) : null}
    </div>
  );
}
