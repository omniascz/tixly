'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatMoney, type Currency } from '@/lib/format';

interface TicketRow {
  id: string;
  status: string;
  ticketTypeName: string;
}

interface Props {
  orderId: string;
  buyerEmail: string;
  orderStatus: string;
  totalAmount: number;
  currency: Currency;
  tickets: TicketRow[];
}

type RefundReason =
  | 'event_cancelled'
  | 'customer_request'
  | 'duplicate_order'
  | 'fraud'
  | 'chargeback';

const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  event_cancelled: 'Akce byla zrušena',
  customer_request: 'Žádost zákazníka',
  duplicate_order: 'Duplicitní objednávka',
  fraud: 'Podezření z podvodu',
  chargeback: 'Chargeback',
};

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

export function SupportActions({
  orderId,
  buyerEmail,
  orderStatus,
  totalAmount,
  currency,
  tickets,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'resend' | 'transfer' | 'name' | 'cancel' | 'refund'>(
    'resend',
  );
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
  const [refundReason, setRefundReason] = useState<RefundReason>('customer_request');
  const [refundConfirm, setRefundConfirm] = useState(false);

  const validTickets = tickets.filter((t) => t.status === 'valid');
  const canRefund = orderStatus === 'paid';
  const alreadyRefunded = orderStatus === 'refunded';

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

  async function fireRefund() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: refundReason, note: note || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        alreadyRefunded?: boolean;
        refundedAmountHalire?: number;
        revokedTickets?: number;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      if (j.alreadyRefunded) {
        setFeedback('Objednávka už byla refundována dříve.');
      } else {
        setFeedback(
          `Refundováno ${formatMoney(j.refundedAmountHalire ?? 0, currency)}, znehodnoceno ${j.revokedTickets ?? 0} lístků. E-mail kupci odeslán.`,
        );
      }
      setNote('');
      setRefundConfirm(false);
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
          <TabButton
            active={tab === 'refund'}
            onClick={() => setTab('refund')}
            label="Refund"
            tone="destructive"
          />
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
                Zruší konkrétní lístek (status='revoked'). Bez refundu — pro refund přepni
                na záložku „Refund".
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

          {tab === 'refund' ? (
            <>
              {alreadyRefunded ? (
                <p className="text-sm text-muted-foreground">
                  Tato objednávka už byla refundována. Další refund není možný.
                </p>
              ) : !canRefund ? (
                <p className="text-sm text-muted-foreground">
                  Refund je možný pouze u zaplacených objednávek (aktuální stav:{' '}
                  <code>{orderStatus}</code>).
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Vrátí kupci <strong>{formatMoney(totalAmount, currency)}</strong>,
                    znehodnotí všechny lístky, vrátí kapacitu do prodeje a odešle e-mail
                    s potvrzením. Akci nelze vrátit zpět.
                  </p>
                  <div>
                    <label
                      htmlFor="refund-reason"
                      className="mb-1 block text-xs font-medium"
                    >
                      Důvod
                    </label>
                    <select
                      id="refund-reason"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value as RefundReason)}
                    >
                      {(Object.keys(REFUND_REASON_LABELS) as RefundReason[]).map((r) => (
                        <option key={r} value={r}>
                          {REFUND_REASON_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="refund-note"
                      className="mb-1 block text-xs font-medium"
                    >
                      Poznámka pro audit log (volitelné)
                    </label>
                    <Input
                      id="refund-note"
                      placeholder="Např. zákazník volal, akce byla zrušena z důvodu nemoci"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                    />
                  </div>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={refundConfirm}
                      onChange={(e) => setRefundConfirm(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Potvrzuji, že chci vrátit{' '}
                      <strong>{formatMoney(totalAmount, currency)}</strong> a znehodnotit
                      všechny vstupenky této objednávky.
                    </span>
                  </label>
                  <Button
                    variant="destructive"
                    onClick={fireRefund}
                    disabled={busy || !refundConfirm}
                  >
                    {busy ? 'Refunduji…' : 'Provést refund'}
                  </Button>
                </>
              )}
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
  tone = 'default',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: 'default' | 'destructive';
}) {
  const activeClass =
    tone === 'destructive'
      ? 'bg-destructive text-destructive-foreground'
      : 'bg-primary text-primary-foreground';
  const idleClass =
    tone === 'destructive'
      ? 'border bg-background text-destructive hover:bg-destructive/10'
      : 'border bg-background hover:bg-muted';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? activeClass : idleClass}`}
    >
      {label}
    </button>
  );
}
