'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TicketType {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  remaining_qty: number | null;
  is_current: boolean;
}

interface TicketInfo {
  id: string;
  event_id: string;
  event_title: string;
  ticket_type_id: string;
  ticket_type_name: string;
  current_price: number;
  status: string;
  allow_changes: boolean;
  deadline_hours: number;
  event_date_start: string;
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

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export function ChangeTicketClient({ ticketId, locale }: { ticketId: string; locale: string }): JSX.Element {
  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: string;
    requiresPayment: boolean;
    priceDiffHalire: number;
    refundAmountHalire: number;
    message: string;
  } | null>(null);

  useEffect(() => {
    void load();
  }, [ticketId]);

  async function load(): Promise<void> {
    try {
      // Load ticket info via my-tickets
      const r = await authFetch(`/api/buyer/my-tickets`);
      const data = await r.json() as { tickets: Array<{
        id: string;
        event_id: string;
        event_title: string;
        ticket_type_id: string;
        ticket_type_name: string;
        event_date: string;
        order_status: string;
      }>};
      const t = data.tickets.find((x) => x.id === ticketId);
      if (!t) {
        setError('Lístek nenalezen.');
        return;
      }
      setTicket({
        id: t.id, event_id: t.event_id, event_title: t.event_title,
        ticket_type_id: t.ticket_type_id, ticket_type_name: t.ticket_type_name,
        current_price: 0, // budeme načítat z ticket_types
        status: 'valid',
        allow_changes: true,
        deadline_hours: 24,
        event_date_start: t.event_date,
      });

      // Load ticket types pro daný event
      const ttRes = await authFetch(`/api/public/events/${t.event_id}/price-preview?channel=online`);
      const ttData = await ttRes.json() as { tickets: Array<{
        ticketTypeId: string;
        ticketTypeName: string;
        unitPrice: number;
        availability: number | null;
        isSoldOut: boolean;
      }> };
      setTypes(
        (ttData.tickets ?? []).map((tt) => ({
          id: tt.ticketTypeId,
          name: tt.ticketTypeName,
          description: null,
          base_price: tt.unitPrice,
          remaining_qty: tt.availability,
          is_current: tt.ticketTypeId === t.ticket_type_id,
        })),
      );

      // Set current price
      const curTt = ttData.tickets?.find((x) => x.ticketTypeId === t.ticket_type_id);
      if (curTt) {
        setTicket((s) => s ? { ...s, current_price: curTt.unitPrice } : s);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba načítání');
    }
  }

  async function submit(): Promise<void> {
    if (!selectedTypeId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await authFetch(`/api/buyer/tickets/${ticketId}/change-request`, {
        method: 'POST',
        body: JSON.stringify({
          changeType: 'ticket_type',
          newTicketTypeId: selectedTypeId,
          reason: reason || undefined,
        }),
      });
      const data = await r.json() as Record<string, unknown>;
      if (!r.ok) {
        throw new Error((data.error as string) ?? `HTTP ${r.status}`);
      }
      setResult({
        status: data.status as string,
        requiresPayment: data.requiresPayment as boolean,
        priceDiffHalire: data.priceDiffHalire as number,
        refundAmountHalire: data.refundAmountHalire as number,
        message: data.message as string,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  if (!ticket) {
    return <p className="text-sm text-muted-foreground">{error ?? 'Načítání…'}</p>;
  }

  const eligibleTypes = types.filter((t) => !t.is_current && t.remaining_qty !== 0 && !t.is_current);
  const selected = types.find((t) => t.id === selectedTypeId);
  const diff = selected ? selected.base_price - ticket.current_price : 0;

  return (
    <div className="space-y-4">
      <Link
        href={`/${locale}/my-tickets`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-3 w-3" /> Zpět
      </Link>

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-semibold">{ticket.event_title}</p>
        <p className="text-xs text-muted-foreground">
          Aktuální: <strong>{ticket.ticket_type_name}</strong> ({fmt(ticket.current_price)})
        </p>
      </div>

      {result ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-900">Žádost odeslána ke schválení</p>
          <p className="mt-1 text-emerald-800">{result.message}</p>
          {result.requiresPayment ? (
            <p className="mt-2 text-emerald-800">
              Po schválení obdržíš link na doplatek <strong>{fmt(result.priceDiffHalire)}</strong>.
            </p>
          ) : null}
          {result.refundAmountHalire > 0 ? (
            <p className="mt-2 text-emerald-800">
              Vrátíme ti <strong>{fmt(result.refundAmountHalire)}</strong> po schválení.
            </p>
          ) : null}
          <Link href={`/${locale}/my-tickets`} className="mt-3 inline-block text-xs text-emerald-700 hover:underline">
            Zpět na lístky →
          </Link>
        </div>
      ) : (
        <>
          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
          ) : null}

          <p className="text-sm font-semibold">Vyber nový typ lístku:</p>
          {eligibleTypes.length === 0 ? (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>Žádné jiné typy lístků nejsou dostupné nebo všechny jsou vyprodané.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {eligibleTypes.map((tt) => (
                <button
                  type="button"
                  key={tt.id}
                  onClick={() => setSelectedTypeId(tt.id)}
                  className={`w-full rounded-md border p-3 text-left transition ${
                    selectedTypeId === tt.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{tt.name}</p>
                      {tt.remaining_qty !== null ? (
                        <p className="text-xs text-muted-foreground">
                          {tt.remaining_qty} volných
                        </p>
                      ) : null}
                    </div>
                    <p className="font-semibold">{fmt(tt.base_price)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected ? (
            <div className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
              diff > 0 ? 'border-amber-300 bg-amber-50' : diff < 0 ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 bg-slate-50'
            }`}>
              {diff > 0 ? <TrendingUp className="h-4 w-4 text-amber-700" /> :
               diff < 0 ? <TrendingDown className="h-4 w-4 text-emerald-700" /> : null}
              {diff > 0 ? (
                <span>Doplatek: <strong>{fmt(diff)}</strong></span>
              ) : diff < 0 ? (
                <span>Refund: <strong>{fmt(-diff)}</strong></span>
              ) : (
                <span>Žádný cenový rozdíl</span>
              )}
            </div>
          ) : null}

          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Důvod změny (volitelně)"
            maxLength={500}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />

          <Button onClick={submit} disabled={busy || !selectedTypeId} className="w-full">
            {busy ? 'Odesílám…' : 'Odeslat žádost o změnu'}
          </Button>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Žádost zpracuje pořadatel. U placených změn dostaneš link na doplatek e-mailem.
      </p>
    </div>
  );
}
