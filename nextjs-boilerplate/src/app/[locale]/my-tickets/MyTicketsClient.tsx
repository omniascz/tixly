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

  useEffect(() => {
    void load();
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

  // Kolik lístků má každá objednávka — pro skupinový QR (1 QR za celou objednávku).
  const orderSize: Record<string, number> = {};
  for (const t of tickets) orderSize[t.order_id] = (orderSize[t.order_id] ?? 0) + 1;

  return (
    <div className="space-y-6">
      {upcoming.length > 0 ? (
        <Section title="Nadcházející">
          {upcoming.map((t) => (
            <TicketCard key={t.id} ticket={t} locale={locale} onChanged={load} groupSize={orderSize[t.order_id] ?? 1} />
          ))}
        </Section>
      ) : null}
      {past.length > 0 ? (
        <Section title="Proběhlé">
          {past.map((t) => (
            <TicketCard key={t.id} ticket={t} locale={locale} onChanged={load} groupSize={orderSize[t.order_id] ?? 1} />
          ))}
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

function TicketCard({
  ticket,
  locale,
  onChanged,
  groupSize = 1,
}: {
  ticket: Ticket;
  locale: string;
  onChanged?: () => void | Promise<void>;
  groupSize?: number;
}) {
  const ccy = isCurrency(ticket.order_currency) ? ticket.order_currency : 'CZK';
  const [walletBusy, setWalletBusy] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimReason, setClaimReason] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimResult, setClaimResult] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundResult, setRefundResult] = useState<{ kind: 'ok' | 'err'; message: string } | null>(
    null,
  );
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmail, setTransferEmail] = useState('');
  const [transferMessage, setTransferMessage] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferResult, setTransferResult] = useState<{
    kind: 'ok' | 'err';
    message: string;
  } | null>(null);
  const [resaleOpen, setResaleOpen] = useState(false);
  const [resaleAskKc, setResaleAskKc] = useState('');
  const [resaleBusy, setResaleBusy] = useState(false);
  const [resaleResult, setResaleResult] = useState<{
    kind: 'ok' | 'err';
    message: string;
  } | null>(null);
  const [activeResaleListingId, setActiveResaleListingId] = useState<string | null>(null);

  // Detekce aktivního listingu (pokud buyer už vystavil → ukážeme "Stáhnout").
  useEffect(() => {
    if (ticket.status !== 'valid') return;
    let cancelled = false;
    void fetch(`/api/buyer/resale/list?ticketId=${ticket.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { active: { listingId: string; askPriceHalire: number } | null } | null) => {
        if (!cancelled) setActiveResaleListingId(data?.active?.listingId ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ticket.id, ticket.status]);

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

  async function transferTicket() {
    const email = transferEmail.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setTransferResult({ kind: 'err', message: 'Zadej platný email.' });
      return;
    }
    setTransferBusy(true);
    setTransferResult(null);
    try {
      const res = await authFetch(`/api/buyer/tickets/${ticket.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: email,
          message: transferMessage.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        recipientEmail?: string;
        transferCount?: number;
      };
      if (res.ok && j.ok) {
        setTransferResult({
          kind: 'ok',
          message: `Lístek odeslán na ${j.recipientEmail}. Příjemce dostal email.`,
        });
        setTransferOpen(false);
        setTransferEmail('');
        setTransferMessage('');
        if (onChanged) await onChanged();
        return;
      }
      const msg = (() => {
        switch (j.error) {
          case 'NOT_OWNER':
            return 'Můžeš převést jen vlastní lístek.';
          case 'TICKET_NOT_VALID':
            return 'Lístek už není platný.';
          case 'ORDER_NOT_PAID':
            return 'Objednávka není zaplacená.';
          case 'SELF_TRANSFER':
            return 'Nelze poslat lístek sám sobě.';
          case 'RECIPIENT_NOT_FOUND':
            return j.message ?? 'Příjemce s tímto emailem nemá účet na Tixly.';
          case 'TICKET_NOT_FOUND':
            return 'Lístek nenalezen.';
          default:
            return j.message ?? j.error ?? `HTTP ${res.status}`;
        }
      })();
      setTransferResult({ kind: 'err', message: msg });
    } catch (e) {
      setTransferResult({ kind: 'err', message: (e as Error).message });
    } finally {
      setTransferBusy(false);
    }
  }

  async function listForResale() {
    const askKc = Number(resaleAskKc.replace(',', '.'));
    if (!Number.isFinite(askKc) || askKc <= 0) {
      setResaleResult({ kind: 'err', message: 'Zadej cenu v Kč (kladné číslo).' });
      return;
    }
    const askHalire = Math.round(askKc * 100);
    setResaleBusy(true);
    setResaleResult(null);
    try {
      const res = await authFetch('/api/buyer/resale/list', {
        method: 'POST',
        body: JSON.stringify({ ticketId: ticket.id, askPriceHalire: askHalire }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        listingId?: string;
        error?: string;
        message?: string;
        maxHalire?: number;
        reason?: string;
      };
      if (res.ok && j.listingId) {
        setResaleResult({
          kind: 'ok',
          message: `Lístek vystaven na marketplace za ${formatMoney(askHalire, ccy)}. Až někdo koupí, dostaneš peníze do 4 dnů.`,
        });
        setActiveResaleListingId(j.listingId);
        setResaleOpen(false);
        setResaleAskKc('');
        return;
      }
      const msg = (() => {
        switch (j.error) {
          case 'ALREADY_LISTED':
            return 'Tento lístek je už na marketplace.';
          case 'PRICE_CAP_EXCEEDED':
            return `Maximální cena je face value (${formatMoney(j.maxHalire ?? 0, ccy)}). Resale nad face value je zakázán.`;
          case 'RESALE_NOT_ELIGIBLE':
            return j.message ?? 'Lístek nelze přeprodat.';
          case 'Not the ticket owner':
            return 'Můžeš prodat jen vlastní lístek.';
          default:
            return j.message ?? j.error ?? `HTTP ${res.status}`;
        }
      })();
      setResaleResult({ kind: 'err', message: msg });
    } catch (e) {
      setResaleResult({ kind: 'err', message: (e as Error).message });
    } finally {
      setResaleBusy(false);
    }
  }

  async function cancelResale() {
    if (!activeResaleListingId) return;
    if (!confirm('Stáhnout lístek z marketplace?')) return;
    setResaleBusy(true);
    try {
      const res = await authFetch(
        `/api/buyer/resale/list/${activeResaleListingId}/cancel`,
        { method: 'POST' },
      );
      if (res.ok) {
        setActiveResaleListingId(null);
        setResaleResult({ kind: 'ok', message: 'Lístek stažen z marketplace.' });
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setResaleResult({ kind: 'err', message: j.error ?? `HTTP ${res.status}` });
      }
    } finally {
      setResaleBusy(false);
    }
  }

  async function requestRefund(scope: 'this' | 'order') {
    setRefundBusy(true);
    setRefundResult(null);
    try {
      const body: { reason?: string; ticketIds?: string[] } = {};
      if (refundReason.trim()) body.reason = refundReason.trim();
      if (scope === 'this') body.ticketIds = [ticket.id];

      const res = await authFetch(`/api/buyer/orders/${ticket.order_id}/refund`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        partial?: boolean;
        refundedHalire?: number;
        revokedTickets?: number;
        remainingValid?: number;
        currentStatus?: string;
      };
      if (res.ok && j.ok) {
        const remainText = j.partial && (j.remainingValid ?? 0) > 0
          ? ` Zbývá ${j.remainingValid} platných lístků v objednávce.`
          : '';
        setRefundResult({
          kind: 'ok',
          message: `Refund schválen: ${formatMoney(j.refundedHalire ?? 0, ccy)} (${j.revokedTickets ?? 0} lístků zrušeno).${remainText}`,
        });
        setRefundOpen(false);
        if (onChanged) await onChanged();
        return;
      }
      const msg = (() => {
        switch (j.error) {
          case 'SELF_REFUND_DISABLED':
            return 'Pořadatel nepovoluje samoobslužný refund. Kontaktuj pořadatele přímo.';
          case 'REFUND_WINDOW_EXPIRED':
            return j.message ?? 'Refund okno již vypršelo.';
          case 'NOT_REFUNDABLE':
            return `Objednávku nelze refundovat (stav: ${j.currentStatus ?? '?'}).`;
          case 'NO_ELIGIBLE_TICKETS':
            return 'Tento lístek už nelze refundovat (možná je už zrušen).';
          case 'NOT_FOUND':
            return 'Objednávka nenalezena.';
          case 'NOT_PAID':
            return 'Objednávka není zaplacená.';
          default:
            return j.message ?? j.error ?? `HTTP ${res.status}`;
        }
      })();
      setRefundResult({ kind: 'err', message: msg });
    } catch (e) {
      setRefundResult({ kind: 'err', message: (e as Error).message });
    } finally {
      setRefundBusy(false);
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
          {groupSize > 1 ? (
            <Link
              href={`/${locale}/orders/${ticket.order_id}/group-qr`}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              data-testid="group-qr-link"
            >
              👥 QR pro skupinu ({groupSize})
            </Link>
          ) : null}
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
          <button
            type="button"
            className="text-xs text-blue-700 hover:underline"
            onClick={() => {
              setTransferOpen((v) => !v);
              setTransferResult(null);
            }}
          >
            {transferOpen ? 'Zrušit přesun' : 'Přeposlat na email'}
          </button>
          {activeResaleListingId ? (
            <button
              type="button"
              className="text-xs text-violet-700 hover:underline"
              onClick={() => void cancelResale()}
              disabled={resaleBusy}
              data-testid="resale-cancel-button"
            >
              💰 Stáhnout z marketplace
            </button>
          ) : (
            <button
              type="button"
              className="text-xs text-violet-700 hover:underline"
              onClick={() => {
                setResaleOpen((v) => !v);
                setResaleResult(null);
              }}
              data-testid="resale-sell-button"
            >
              {resaleOpen ? 'Zrušit prodej' : '💰 Prodat na marketplace'}
            </button>
          )}
          <button
            type="button"
            className="text-xs text-rose-700 hover:underline"
            onClick={() => {
              setRefundOpen((v) => !v);
              setRefundResult(null);
            }}
          >
            {refundOpen ? 'Zrušit' : 'Požádat o refundaci'}
          </button>
          <Link
            href={`/${locale}/my-tickets/${ticket.id}/attendee`}
            className="text-xs text-slate-700 hover:underline"
          >
            ✏️ Změnit jméno/email
          </Link>
          <Link
            href={`/${locale}/my-tickets/${ticket.id}/change`}
            className="text-xs text-amber-700 hover:underline"
          >
            ↔️ Změnit typ lístku
          </Link>
          <Link
            href={`/${locale}/my-tickets/${ticket.id}/exchange`}
            className="text-xs text-indigo-700 hover:underline"
          >
            📅 Změnit termín
          </Link>
          <Link
            href={`/${locale}/my-tickets/${ticket.id}/cancel-order`}
            className="text-xs text-rose-800 hover:underline"
          >
            ✕ Zrušit objednávku
          </Link>
        </div>
      ) : null}

      {transferOpen ? (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs">
          <p className="mb-2 font-medium text-blue-900">
            Lístek převedeš jinému uživateli (musí mít účet na Tixly). Po převodu už lístek
            neuvidíš ve svém seznamu.
          </p>
          <input
            type="email"
            className="w-full rounded border border-blue-300 bg-white p-2 text-xs"
            placeholder="Email příjemce…"
            value={transferEmail}
            onChange={(e) => setTransferEmail(e.target.value)}
            disabled={transferBusy}
            autoComplete="off"
          />
          <textarea
            className="mt-2 w-full rounded border border-blue-300 bg-white p-2 text-xs"
            rows={2}
            placeholder="Zpráva pro příjemce (volitelné)…"
            value={transferMessage}
            onChange={(e) => setTransferMessage(e.target.value)}
            disabled={transferBusy}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={transferTicket} disabled={transferBusy || !transferEmail.trim()}>
              {transferBusy ? 'Odesílám…' : 'Odeslat lístek'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTransferOpen(false)}
              disabled={transferBusy}
            >
              Zpět
            </Button>
          </div>
        </div>
      ) : null}

      {transferResult ? (
        <p
          className={`mt-2 text-xs ${transferResult.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}
        >
          {transferResult.message}
        </p>
      ) : null}

      {resaleOpen ? (
        <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 p-3 text-xs">
          <p className="mb-2 font-medium text-violet-900">
            Lístek nabídneš na resale marketplace. Cena nesmí být vyšší než face value
            (anti-scalping). Až někdo koupí, dostaneš peníze do 4 dnů a kupec dostane nový
            lístek se svým jménem (původní bude neplatný).
          </p>
          <label className="mb-1 block font-medium text-violet-900">
            Cena v Kč
          </label>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            className="w-full rounded border border-violet-300 bg-white p-2"
            placeholder="např. 450"
            value={resaleAskKc}
            onChange={(e) => setResaleAskKc(e.target.value)}
            disabled={resaleBusy}
            data-testid="resale-ask-price-input"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void listForResale()}
              disabled={resaleBusy || !resaleAskKc.trim()}
              data-testid="resale-confirm-button"
            >
              {resaleBusy ? 'Vystavuji…' : 'Vystavit na marketplace'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setResaleOpen(false)}
              disabled={resaleBusy}
            >
              Zpět
            </Button>
          </div>
        </div>
      ) : null}

      {resaleResult ? (
        <p
          className={`mt-2 text-xs ${resaleResult.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}
          data-testid="resale-result-message"
        >
          {resaleResult.message}
        </p>
      ) : null}

      {refundOpen ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs">
          <p className="mb-2 font-medium text-rose-900">
            Vyber rozsah refundace. Peníze se vrátí na původní platební metodu.
          </p>
          <textarea
            className="w-full rounded border border-rose-300 bg-white p-2 text-xs"
            rows={2}
            placeholder="Důvod (volitelné)…"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            disabled={refundBusy}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => requestRefund('this')}
              disabled={refundBusy}
            >
              {refundBusy ? 'Odesílám…' : 'Refundovat tento lístek'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => requestRefund('order')}
              disabled={refundBusy}
            >
              Refundovat celou objednávku
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRefundOpen(false)}
              disabled={refundBusy}
            >
              Zpět
            </Button>
          </div>
        </div>
      ) : null}

      {refundResult ? (
        <p
          className={`mt-2 text-xs ${refundResult.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}
        >
          {refundResult.message}
        </p>
      ) : null}

      {walletError ? <p className="mt-2 text-xs text-rose-700">{walletError}</p> : null}
    </div>
  );
}
