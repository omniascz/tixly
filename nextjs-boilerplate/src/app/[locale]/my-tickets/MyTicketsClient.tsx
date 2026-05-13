'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatMoney, isCurrency } from '@/lib/format';

interface Ticket {
  id: string;
  status: string;
  used_at: string | null;
  revoked_at: string | null;
  order_id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  ticket_type_id: string;
  ticket_type_name: string;
  venue_name: string | null;
  pass_kind: string | null;
  picks_required: number | null;
  picks_used: number;
  redemption_count: number;
  order_status: string;
  order_currency: string;
  insurance_status: string | null;
  insurance_premium: number | null;
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

export function MyTicketsClient({ locale }: { locale: string }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await authFetch('/api/buyer/my-tickets');
        if (res.status === 401) {
          setError('Pro zobrazení lístků se musíš přihlásit.');
          return;
        }
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as { tickets: Ticket[] };
        setTickets(json.tickets);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
        <div className="mt-2">
          <Link href={`/${locale}/login`} className="text-primary hover:underline">
            Přihlásit se →
          </Link>
        </div>
      </div>
    );
  }
  if (!tickets) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }
  if (tickets.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">Zatím nemáš žádné lístky.</p>
        <Link
          href={`/${locale}/events`}
          className="mt-3 inline-block text-sm text-primary hover:underline"
        >
          Prohlížet akce →
        </Link>
      </div>
    );
  }

  const now = Date.now();
  const upcoming = tickets.filter((t) => new Date(t.event_date).getTime() >= now);
  const past = tickets.filter((t) => new Date(t.event_date).getTime() < now);

  return (
    <div className="space-y-6">
      {upcoming.length > 0 ? (
        <Section title="Nadcházející">
          {upcoming.map((t) => <TicketCard key={t.id} ticket={t} locale={locale} />)}
        </Section>
      ) : null}
      {past.length > 0 ? (
        <Section title="Proběhlé">
          {past.map((t) => <TicketCard key={t.id} ticket={t} locale={locale} />)}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function TicketCard({ ticket, locale }: { ticket: Ticket; locale: string }) {
  const ccy = isCurrency(ticket.order_currency) ? ticket.order_currency : 'CZK';
  const [walletBusy, setWalletBusy] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimReason, setClaimReason] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimResult, setClaimResult] = useState<string | null>(null);

  const statusBadge = (() => {
    if (ticket.status === 'valid') {
      return { label: 'Platný', tone: 'bg-emerald-100 text-emerald-800' };
    }
    if (ticket.status === 'used') {
      return { label: 'Použito', tone: 'bg-slate-100 text-slate-700' };
    }
    if (ticket.status === 'revoked') {
      return { label: 'Zrušeno', tone: 'bg-rose-100 text-rose-800' };
    }
    return { label: ticket.status, tone: 'bg-muted text-muted-foreground' };
  })();

  async function downloadApple() {
    setWalletBusy('apple');
    setWalletError(null);
    try {
      const res = await authFetch(`/api/buyer/tickets/${ticket.id}/wallet/apple`);
      if (!res.ok) {
        setWalletError(`Apple wallet: ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tixly-${ticket.id}.pass.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setWalletBusy(null);
    }
  }

  async function openGoogle() {
    setWalletBusy('google');
    setWalletError(null);
    try {
      const res = await authFetch(`/api/buyer/tickets/${ticket.id}/wallet/google`);
      if (!res.ok) {
        setWalletError(`Google wallet: ${res.status}`);
        return;
      }
      const j = (await res.json()) as { saveUrl: string };
      window.open(j.saveUrl, '_blank', 'noopener');
    } finally {
      setWalletBusy(null);
    }
  }

  async function fileClaim() {
    if (!claimReason.trim()) return;
    setClaimBusy(true);
    setClaimResult(null);
    try {
      const res = await authFetch(`/api/buyer/orders/${ticket.order_id}/insurance-claim`, {
        method: 'POST',
        body: JSON.stringify({ reason: claimReason }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        claimAmount?: number;
      };
      if (!res.ok || !j.ok) {
        setClaimResult(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setClaimResult(
        `Refund ${j.claimAmount ? formatMoney(j.claimAmount, ccy) : ''} schválen. Stránku obnov.`,
      );
    } finally {
      setClaimBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{ticket.event_title}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge.tone}`}
            >
              {statusBadge.label}
            </span>
            {ticket.pass_kind ? (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">
                {ticket.pass_kind === 'season' ? 'Season pass' : 'Flex pass'}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {ticket.ticket_type_name}
            {ticket.venue_name ? ` · ${ticket.venue_name}` : ''}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(ticket.event_date).toLocaleString('cs-CZ', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
          </div>
        </div>
      </div>

      {ticket.pass_kind === 'flex' ? (
        <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span>
              Flex pass: vybráno {ticket.picks_used}/{ticket.picks_required ?? '?'} termínů
              · použito {ticket.redemption_count}×
            </span>
            <Link
              href={`/${locale}/tickets/${ticket.id}/picks`}
              className="font-medium text-primary hover:underline"
            >
              Vybrat termíny →
            </Link>
          </div>
        </div>
      ) : null}

      {ticket.insurance_status === 'active' && ticket.status === 'valid' ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-amber-900">
              Pojistka zrušení aktivní (premium {formatMoney(ticket.insurance_premium ?? 0, ccy)})
            </span>
            <button
              type="button"
              className="font-medium text-amber-900 hover:underline"
              onClick={() => setClaimOpen((o) => !o)}
            >
              {claimOpen ? 'Zavřít' : 'Uplatnit refund'}
            </button>
          </div>
          {claimOpen ? (
            <div className="mt-2 space-y-2">
              <textarea
                className="w-full rounded border border-amber-300 bg-white p-2 text-xs"
                rows={3}
                placeholder="Důvod (3+ znaky)…"
                value={claimReason}
                onChange={(e) => setClaimReason(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={fileClaim} disabled={claimBusy || !claimReason.trim()}>
                  {claimBusy ? 'Odesílám…' : 'Odeslat žádost'}
                </Button>
                {claimResult ? <span className="text-xs">{claimResult}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {ticket.status === 'valid' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={`/${locale}/tickets/${ticket.id}/show`}
            className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            data-testid="show-qr-link"
          >
            📲 Zobrazit QR
          </Link>
          <Button size="sm" variant="outline" onClick={downloadApple} disabled={walletBusy === 'apple'}>
            {walletBusy === 'apple' ? '…' : '📱 Apple Wallet'}
          </Button>
          <Button size="sm" variant="outline" onClick={openGoogle} disabled={walletBusy === 'google'}>
            {walletBusy === 'google' ? '…' : '📱 Google Wallet'}
          </Button>
          <a
            href={`/api/buyer/tickets/${ticket.id}/calendar`}
            className="inline-flex items-center rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            📅 Do kalendáře
          </a>
          <Link
            href={`/${locale}/order-confirmation/${ticket.order_id}`}
            className="text-xs text-primary hover:underline"
          >
            Detail objednávky →
          </Link>
        </div>
      ) : null}
      {walletError ? (
        <p className="mt-2 text-xs text-rose-700">{walletError}</p>
      ) : null}
    </div>
  );
}
