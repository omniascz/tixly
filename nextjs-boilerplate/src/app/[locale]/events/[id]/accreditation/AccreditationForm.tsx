'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Category = 'media' | 'vip' | 'staff' | 'sponsor' | 'performer' | 'guest';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'media', label: 'Média (novináři, foto/video)' },
  { value: 'vip', label: 'VIP host' },
  { value: 'staff', label: 'Staff (technika, security, catering)' },
  { value: 'sponsor', label: 'Sponzor' },
  { value: 'performer', label: 'Účinkující' },
  { value: 'guest', label: 'Pozvaný host' },
];

export function AccreditationForm({ eventId }: { eventId: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [category, setCategory] = useState<Category>('media');
  const [roleDetail, setRoleDetail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/events/${eventId}/accreditation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          organization: organization.trim() || undefined,
          category,
          roleDetail: roleDetail.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        requestId?: string;
      };
      if (res.ok && j.ok) {
        setResult({
          kind: 'ok',
          text: 'Žádost odeslána. Pořadatel ti pošle vyrozumění emailem (typicky 3–7 dní).',
        });
        // reset
        setName('');
        setEmail('');
        setOrganization('');
        setRoleDetail('');
        setMessage('');
        return;
      }
      const msg =
        j.error === 'DUPLICATE'
          ? j.message ?? 'Žádost pro tento email a kategorii už existuje.'
          : j.error === 'EVENT_NOT_FOUND'
            ? 'Akce nenalezena nebo není veřejná.'
            : j.message ?? j.error ?? `HTTP ${res.status}`;
      setResult({ kind: 'err', text: msg });
    } catch (err) {
      setResult({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border bg-card p-4">
      <div>
        <label htmlFor="acc-name" className="mb-1 block text-xs font-medium">
          Celé jméno *
        </label>
        <Input
          id="acc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          disabled={busy}
        />
      </div>

      <div>
        <label htmlFor="acc-email" className="mb-1 block text-xs font-medium">
          Email *
        </label>
        <Input
          id="acc-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={320}
          disabled={busy}
        />
      </div>

      <div>
        <label htmlFor="acc-org" className="mb-1 block text-xs font-medium">
          Organizace / médium
        </label>
        <Input
          id="acc-org"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          maxLength={160}
          disabled={busy}
          placeholder="např. iDNES.cz, Česká televize, Radio 1…"
        />
      </div>

      <div>
        <label htmlFor="acc-cat" className="mb-1 block text-xs font-medium">
          Kategorie *
        </label>
        <select
          id="acc-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          disabled={busy}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          required
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="acc-role" className="mb-1 block text-xs font-medium">
          Konkrétní role
        </label>
        <Input
          id="acc-role"
          value={roleDetail}
          onChange={(e) => setRoleDetail(e.target.value)}
          maxLength={160}
          disabled={busy}
          placeholder="např. fotograf, technika světel, gitarista…"
        />
      </div>

      <div>
        <label htmlFor="acc-msg" className="mb-1 block text-xs font-medium">
          Zpráva pro pořadatele
        </label>
        <textarea
          id="acc-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={1000}
          disabled={busy}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Doplň co je relevantní (link na článek, doporučení, technický rider…)"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {message.length}/1000 znaků
        </p>
      </div>

      <Button type="submit" disabled={busy || !name.trim() || !email.trim()}>
        {busy ? 'Odesílám…' : 'Odeslat žádost'}
      </Button>

      {result ? (
        <p
          className={`text-sm ${
            result.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {result.text}
        </p>
      ) : null}
    </form>
  );
}
