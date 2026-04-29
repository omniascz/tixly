'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TicketRow {
  id: string;
  status: string;
  ticketTypeName: string;
}

interface Props {
  orderId: string;
  buyerEmail: string;
  tickets: TicketRow[];
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function SupportActions({ orderId, buyerEmail, tickets }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'resend' | 'transfer' | 'name' | 'cancel'>('resend');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Per-tab state
  const [transferTicketId, setTransferTicketId] = useState('');
  const [transferEmail, setTransferEmail] = useState('');
  const [transferName, setTransferName] = useState('');
  const [nameTicketId, setNameTicketId] = useState('');
  const [newName, setNewName] = useState('');
  const [cancelTicketId, setCancelTicketId] = useState('');
  const [note, setNote] = useState('');

  const validTickets = tickets.filter((t) => t.status === 'valid');

  async function fire(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/support-action`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, note: note || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Hotovo.');
      setNote('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer support</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          <TabButton active={tab === 'resend'} onClick={() => setTab('resend')} label="Resend e-mail" />
          <TabButton active={tab === 'transfer'} onClick={() => setTab('transfer')} label="Transfer" />
          <TabButton active={tab === 'name'} onClick={() => setTab('name')} label="Změna jména" />
          <TabButton active={tab === 'cancel'} onClick={() => setTab('cancel')} label="Zrušit lístek" />
        </div>

        <div className="space-y-3">
          {tab === 'resend' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Pošle confirmation email znovu na <strong>{buyerEmail}</strong>.
              </p>
              <Input
                placeholder="Poznámka (volitelné, do audit logu)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button onClick={() => fire({ action: 'resend_email' })} disabled={busy}>
                {busy ? 'Posílám…' : 'Poslat znovu'}
              </Button>
            </>
          ) : null}

          {tab === 'transfer' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Převede lístek na jiný e-mail. Cílový uživatel bude vytvořen pokud neexistuje.
              </p>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={transferTicketId}
                onChange={(e) => setTransferTicketId(e.target.value)}
              >
                <option value="">— vyber lístek —</option>
                {validTickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ticketTypeName} ({t.id.slice(0, 8)})
                  </option>
                ))}
              </select>
              <Input
                type="email"
                placeholder="Cílový e-mail"
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
              />
              <Input
                placeholder="Cílové jméno (volitelné)"
                value={transferName}
                onChange={(e) => setTransferName(e.target.value)}
              />
              <Input
                placeholder="Poznámka pro audit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                onClick={() =>
                  fire({
                    action: 'transfer',
                    ticketId: transferTicketId,
                    targetEmail: transferEmail,
                    targetName: transferName || undefined,
                  })
                }
                disabled={busy || !transferTicketId || !transferEmail}
              >
                {busy ? 'Převádím…' : 'Převést'}
              </Button>
            </>
          ) : null}

          {tab === 'name' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Změní jméno držitele lístku (zobrazí se na PDF / wallet pasu).
              </p>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={nameTicketId}
                onChange={(e) => setNameTicketId(e.target.value)}
              >
                <option value="">— vyber lístek —</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ticketTypeName} ({t.id.slice(0, 8)})
                  </option>
                ))}
              </select>
              <Input
                placeholder="Nové jméno"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                placeholder="Poznámka pro audit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                onClick={() =>
                  fire({ action: 'name_change', ticketId: nameTicketId, newName })
                }
                disabled={busy || !nameTicketId || !newName}
              >
                {busy ? 'Měním…' : 'Změnit jméno'}
              </Button>
            </>
          ) : null}

          {tab === 'cancel' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Zruší konkrétní lístek (status='revoked'). Bez refundu — pro refund použij
                button výše.
              </p>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={cancelTicketId}
                onChange={(e) => setCancelTicketId(e.target.value)}
              >
                <option value="">— vyber lístek —</option>
                {validTickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.ticketTypeName} ({t.id.slice(0, 8)})
                  </option>
                ))}
              </select>
              <Input
                placeholder="Důvod (audit)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                variant="destructive"
                onClick={() => fire({ action: 'cancel_ticket', ticketId: cancelTicketId })}
                disabled={busy || !cancelTicketId}
              >
                {busy ? 'Ruším…' : 'Zrušit lístek'}
              </Button>
            </>
          ) : null}

          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
              {error}
            </div>
          ) : null}
          {feedback ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
              {feedback}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
          : 'rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted'
      }
    >
      {label}
    </button>
  );
}
