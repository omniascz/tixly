'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefundForm, type RefundSubmit } from '@/components/admin/RefundForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  const [tab, setTab] = useState<'resend' | 'message' | 'transfer' | 'name' | 'cancel' | 'refund'>(
    'resend',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Per-tab state
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [transferTicketId, setTransferTicketId] = useState('');
  const [transferEmail, setTransferEmail] = useState('');
  const [transferName, setTransferName] = useState('');
  const [nameTicketId, setNameTicketId] = useState('');
  const [newName, setNewName] = useState('');
  const [cancelTicketId, setCancelTicketId] = useState('');
  const [note, setNote] = useState('');
  const [altEmail, setAltEmail] = useState('');

  const validTickets = tickets.filter((t) => t.status === 'valid');
  const canRefund = orderStatus === 'paid';
  const alreadyRefunded = orderStatus === 'refunded';

  /** Co se stalo — hláška „Hotovo." uživateli neřekla, jestli e-mail odešel. */
  const DONE_MESSAGES: Record<string, string> = {
    resend_email: 'Potvrzení objednávky odesláno znovu.',
    send_message: 'Zpráva kupujícímu odeslána.',
    transfer: 'Vstupenka převedena na nový e-mail.',
    name_change: 'Jméno na vstupence změněno.',
    cancel_ticket: 'Vstupenka zneplatněna. Peníze se nevracely.',
  };

  /**
   * Odeslání vstupenek jde vlastní cestou, ne přes znovuspuštění dokončení
   * objednávky. To by kromě e-mailu znovu poslalo i SMS a znovu spustilo
   * měřicí kódy — pro pouhé přeposlání vstupenky nežádoucí.
   */
  async function sendTickets() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/send-tickets`, {
        method: 'POST',
        body: JSON.stringify({
          toOverride: altEmail.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.message ?? j.error ?? `Nepodařilo se odeslat (HTTP ${res.status}).`);
        return;
      }
      setFeedback(j.message ?? 'Vstupenky odeslány.');
      setNote('');
      setAltEmail('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

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
        setError(j.error ?? `Nepodařilo se to provést (HTTP ${res.status}).`);
        return;
      }
      const action = typeof payload.action === 'string' ? payload.action : '';
      setFeedback(DONE_MESSAGES[action] ?? 'Provedeno.');
      setNote('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function fireRefund({ reason, note: refundNote }: RefundSubmit) {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason, note: refundNote }),
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
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function printLabels() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/orders/${orderId}/print-labels`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Tisk selhal (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError('Tisk selhal (síť).');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Podpora zákazníka</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-sm">
            <span className="font-medium">Tištěné vstupenky</span>{' '}
            <span className="text-muted-foreground">— formát 152×51 mm pro termotiskárnu (Zebra/TSC)</span>
          </div>
          <Button variant="outline" size="sm" onClick={printLabels} disabled={busy}>
            {busy ? 'Generuji…' : 'Tisk vstupenek'}
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <TabButton active={tab === 'resend'} onClick={() => setTab('resend')} label="Poslat znovu" />
          <TabButton active={tab === 'message'} onClick={() => setTab('message')} label="Napsat zprávu" />
          <TabButton active={tab === 'transfer'} onClick={() => setTab('transfer')} label="Převod na jiného" />
          <TabButton active={tab === 'name'} onClick={() => setTab('name')} label="Změna jména" />
          <TabButton active={tab === 'cancel'} onClick={() => setTab('cancel')} label="Zrušit lístek" />
          <TabButton
            active={tab === 'refund'}
            onClick={() => setTab('refund')}
            label="Vrátit peníze"
            tone="destructive"
          />
        </div>

        <div className="space-y-3">
          {tab === 'resend' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Pošle vstupenky s QR kódem na <strong>{buyerEmail}</strong>, nebo na jinou adresu.
                Funguje i u objednávek na fakturu a bankovní převod, které e-mail nikdy nedostaly.
              </p>
              <Input
                placeholder="Poslat na jinou adresu (volitelné)"
                value={altEmail}
                onChange={(e) => setAltEmail(e.target.value)}
              />
              <Input
                placeholder="Poznámka do e-mailu (volitelné)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button onClick={() => void sendTickets()} disabled={busy}>
                {busy ? 'Posílám…' : 'Poslat vstupenky'}
              </Button>
            </>
          ) : null}

          {tab === 'message' ? (
            <>
              <p className="text-sm text-muted-foreground">
                Pošle individuální zprávu kupci na <strong>{buyerEmail}</strong>.
                Pro změnu programu, výjimku, omluvu — cokoliv, co není standardní
                template.
              </p>
              <Input
                placeholder="Předmět"
                value={messageSubject}
                onChange={(e) => setMessageSubject(e.target.value)}
                maxLength={200}
              />
              <textarea
                placeholder="Text zprávy (oslovení už doplníme)"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                rows={6}
                maxLength={5000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <Input
                placeholder="Poznámka pro audit"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                onClick={() =>
                  fire({
                    action: 'send_message',
                    subject: messageSubject,
                    body: messageBody,
                  })
                }
                disabled={busy || messageSubject.length < 3 || messageBody.length < 10}
              >
                {busy ? 'Posílám…' : 'Odeslat zprávu'}
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
                // Tentýž formulář používá i seznam objednávek — viz
                // components/admin/RefundForm.tsx. Dřív tu byly dvě různé
                // implementace a ta v seznamu důvod vůbec nenabízela.
                <RefundForm
                  consequence={`Vrátí kupujícímu ${formatMoney(totalAmount, currency)} na původní platební metodu, zneplatní všechny vstupenky této objednávky, vrátí kapacitu do prodeje a odešle potvrzení e-mailem. Akci nelze vzít zpět.`}
                  confirmLabel={`Potvrzuji vrácení ${formatMoney(totalAmount, currency)} a zneplatnění všech vstupenek této objednávky.`}
                  submitLabel="Vrátit peníze"
                  busy={busy}
                  onSubmit={fireRefund}
                />
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
