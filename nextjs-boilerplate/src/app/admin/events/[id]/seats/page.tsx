'use client';

/**
 * /admin/events/[id]/seats
 *
 * Live mapa sedadel pro promotéra — vidí stav v reálném čase (polling 3 s).
 * Kliknutí na sedadlo otevře panel pro Hold / Release přímo z mapy.
 */

import { useCallback, useEffect, useRef, useState, use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface SeatData {
  id: string;
  sector: string;
  row: string;
  seatNumber: string;
  x: number;
  y: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  holdUntil: string | null;
  holdKind: string | null;
  ticketTypeName: string | null;
  accessibility: boolean;
}

interface LiveResponse {
  viewBox: string;
  seats: SeatData[];
  summary: { available: number; held: number; sold: number; blocked: number };
  fetchedAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  held: '#f59e0b',
  sold: '#ef4444',
  blocked: '#94a3b8',
};

const STATUS_LABEL: Record<string, string> = {
  available: 'Volné',
  held: 'Rezervováno',
  sold: 'Prodáno',
  blocked: 'Blokováno',
};

const ADMIN_HOLD_KINDS = [
  { value: 'artist', label: 'Artist hold' },
  { value: 'promoter', label: 'Promoter VIP' },
  { value: 'comp', label: 'Comp (zdarma)' },
  { value: 'production', label: 'Production kill' },
] as const;

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

export default function AdminSeatsPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id: eventId } = params;
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [tooltip, setTooltip] = useState<{ seat: SeatData; mx: number; my: number } | null>(null);
  const [actionSeat, setActionSeat] = useState<SeatData | null>(null);
  const [holdKind, setHoldKind] = useState<string>('artist');
  const [holdLabel, setHoldLabel] = useState('');
  const [holdUntil, setHoldUntil] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchRef = useRef<string>('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/seats/live`);
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const j = (await res.json()) as LiveResponse;
      if (j.fetchedAt !== lastFetchRef.current) {
        lastFetchRef.current = j.fetchedAt;
        setData(j);
        // refresh actionSeat data if panel is open
        if (actionSeat) {
          const updated = j.seats.find((s) => s.id === actionSeat.id);
          if (updated) setActionSeat(updated);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [eventId, actionSeat]);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => { void load(); }, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  async function doHold() {
    if (!actionSeat) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const body: Record<string, unknown> = {
        seatIds: [actionSeat.id],
        kind: holdKind,
      };
      if (holdLabel.trim()) body.label = holdLabel.trim();
      if (holdUntil) body.releaseAt = new Date(holdUntil).toISOString();
      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setActionMsg(`Chyba: ${j.error ?? `HTTP ${res.status}`}`);
      } else {
        setActionMsg('Hold vytvořen.');
        setHoldLabel('');
        setHoldUntil('');
        void load();
      }
    } catch (e) {
      setActionMsg(`Chyba: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function doRelease() {
    if (!actionSeat) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/holds`, {
        method: 'DELETE',
        body: JSON.stringify({ seatIds: [actionSeat.id] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setActionMsg(`Chyba: ${j.error ?? `HTTP ${res.status}`}`);
      } else {
        setActionMsg('Sedadlo uvolněno.');
        void load();
      }
    } catch (e) {
      setActionMsg(`Chyba: ${(e as Error).message}`);
    } finally {
      setActionBusy(false);
    }
  }

  if (error) {
    return (
      <div className="p-6 rounded-md border border-rose-300 bg-rose-50 text-sm text-rose-900">
        Chyba: {error}
      </div>
    );
  }
  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">Načítání mapy sedadel…</p>;
  }

  const visibleSeats = filter === 'all' ? data.seats : data.seats.filter((s) => s.status === filter);
  const total = data.summary.available + data.summary.held + data.summary.sold + data.summary.blocked;
  const soldPct = total > 0 ? Math.round((data.summary.sold / total) * 100) : 0;
  const isAdminHeld = (s: SeatData) =>
    (s.status === 'held' || s.status === 'blocked') &&
    s.holdKind !== null &&
    s.holdKind !== 'customer';

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href={`/admin/events/${eventId}`} className="text-sm text-primary hover:underline">
            ← Zpět na event
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Mapa sedadel — live</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aktualizace každé 3 s · poslední:{' '}
            {new Date(data.fetchedAt).toLocaleTimeString('cs-CZ')} ·{' '}
            <span className="font-medium">Kliknutím na sedadlo → Hold / Uvolnit</span>
          </p>
        </div>
        <div className="flex gap-3 text-sm flex-wrap">
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? 'all' : key)}
              className={`flex items-center gap-1.5 rounded px-2 py-1 border transition-colors ${
                filter === key ? 'border-foreground bg-muted' : 'border-transparent hover:bg-muted/50'
              }`}
            >
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: STATUS_COLOR[key] }} />
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground">{data.summary[key as keyof typeof data.summary]}</span>
            </button>
          ))}
          <div className="flex items-center gap-1 text-muted-foreground">
            Prodáno: <span className="font-bold text-foreground ml-1">{soldPct} %</span>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        {/* SVG mapa */}
        <div
          className="relative flex-1 overflow-auto rounded-xl border bg-slate-950"
          style={{ maxHeight: '70vh' }}
          onMouseLeave={() => setTooltip(null)}
        >
          {data.seats.length === 0 ? (
            <p className="p-6 text-sm text-amber-200">
              Tento event nemá vygenerovaná sedadla.
            </p>
          ) : (
            <svg viewBox={data.viewBox} className="w-full h-auto min-h-[400px]" style={{ display: 'block' }}>
              {visibleSeats.map((seat) => (
                <circle
                  key={seat.id}
                  cx={seat.x}
                  cy={seat.y}
                  r={10}
                  fill={STATUS_COLOR[seat.status] ?? '#94a3b8'}
                  opacity={filter === 'all' || seat.status === filter ? 1 : 0.15}
                  stroke={
                    actionSeat?.id === seat.id
                      ? '#fff'
                      : seat.accessibility
                        ? '#fff'
                        : 'none'
                  }
                  strokeWidth={actionSeat?.id === seat.id ? 3 : seat.accessibility ? 2 : 0}
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={(e) => {
                    const rect = (e.target as SVGCircleElement).closest('svg')!.getBoundingClientRect();
                    setTooltip({ seat, mx: e.clientX - rect.left, my: e.clientY - rect.top });
                  }}
                  onClick={() => {
                    setActionSeat(seat);
                    setActionMsg(null);
                    setHoldLabel('');
                    setHoldUntil('');
                    setHoldKind('artist');
                  }}
                />
              ))}
            </svg>
          )}

          {/* Tooltip (hover) */}
          {tooltip && tooltip.seat.id !== actionSeat?.id && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg"
              style={{ left: tooltip.mx + 12, top: tooltip.my - 8 }}
            >
              <div className="font-semibold">
                {tooltip.seat.sector} · ř. {tooltip.seat.row} · sed. {tooltip.seat.seatNumber}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[tooltip.seat.status] }} />
                {STATUS_LABEL[tooltip.seat.status]}
                {tooltip.seat.holdKind ? ` (${tooltip.seat.holdKind})` : ''}
              </div>
              {tooltip.seat.ticketTypeName && (
                <div className="text-muted-foreground mt-0.5">{tooltip.seat.ticketTypeName}</div>
              )}
              {tooltip.seat.holdUntil && tooltip.seat.status === 'held' && (
                <div className="text-amber-600 mt-0.5">
                  Do {new Date(tooltip.seat.holdUntil).toLocaleTimeString('cs-CZ')}
                </div>
              )}
              {tooltip.seat.accessibility && <div className="text-blue-400 mt-0.5">♿</div>}
              <div className="text-muted-foreground/60 mt-1 italic">Klikni pro akci</div>
            </div>
          )}
        </div>

        {/* Hold / Release panel */}
        {actionSeat && (
          <div className="w-72 flex-shrink-0 rounded-xl border bg-card p-4 space-y-3 self-start sticky top-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Sedadlo</h3>
              <button
                onClick={() => { setActionSeat(null); setActionMsg(null); }}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
                aria-label="Zavřít"
              >×</button>
            </div>

            <div className="rounded-md bg-muted/40 p-2 text-xs space-y-0.5">
              <div className="font-medium">
                {actionSeat.sector} · řada {actionSeat.row} · sedadlo {actionSeat.seatNumber}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[actionSeat.status] }} />
                {STATUS_LABEL[actionSeat.status]}
                {actionSeat.holdKind ? ` · ${actionSeat.holdKind}` : ''}
              </div>
              {actionSeat.ticketTypeName && (
                <div className="text-muted-foreground">{actionSeat.ticketTypeName}</div>
              )}
              {actionSeat.holdUntil && (
                <div className="text-amber-600">
                  Hold do {new Date(actionSeat.holdUntil).toLocaleString('cs-CZ')}
                </div>
              )}
            </div>

            {/* Release — pro admin-held nebo blocked sedadla */}
            {isAdminHeld(actionSeat) && (
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => void doRelease()}
                  disabled={actionBusy}
                >
                  {actionBusy ? 'Uvolňuji…' : '✓ Uvolnit sedadlo'}
                </Button>
              </div>
            )}

            {/* Hold — jen pro volná sedadla */}
            {actionSeat.status === 'available' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Typ holdu</label>
                  <select
                    value={holdKind}
                    onChange={(e) => setHoldKind(e.target.value)}
                    className="w-full rounded border bg-background px-2 py-1.5 text-xs"
                  >
                    {ADMIN_HOLD_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Popisek (volitelný)</label>
                  <input
                    type="text"
                    value={holdLabel}
                    onChange={(e) => setHoldLabel(e.target.value)}
                    placeholder="např. Adam Novák"
                    className="w-full rounded border bg-background px-2 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Uvolnit v (volitelné)</label>
                  <input
                    type="datetime-local"
                    value={holdUntil}
                    onChange={(e) => setHoldUntil(e.target.value)}
                    className="w-full rounded border bg-background px-2 py-1.5 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => void doHold()}
                  disabled={actionBusy}
                >
                  {actionBusy ? 'Blokuji…' : '🔒 Zablokovat sedadlo'}
                </Button>
              </div>
            )}

            {/* Prodané / customer hold — info only */}
            {actionSeat.status === 'sold' && (
              <p className="text-xs text-muted-foreground">Sedadlo je prodáno — nelze měnit.</p>
            )}
            {actionSeat.status === 'held' && actionSeat.holdKind === 'customer' && (
              <p className="text-xs text-muted-foreground">
                Zákaznická rezervace (checkout) — automaticky vyprší{' '}
                {actionSeat.holdUntil ? `v ${new Date(actionSeat.holdUntil).toLocaleTimeString('cs-CZ')}` : 'brzy'}.
              </p>
            )}

            {actionMsg && (
              <p className={`text-xs rounded px-2 py-1.5 ${actionMsg.startsWith('Chyba') ? 'bg-rose-50 text-rose-700' : 'bg-green-50 text-green-700'}`}>
                {actionMsg}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>Celkem: <strong className="text-foreground">{total}</strong></span>
        <span>·</span>
        <span>Volných: <strong className="text-green-600">{data.summary.available}</strong></span>
        <span>·</span>
        <span>Rezerv.: <strong className="text-amber-600">{data.summary.held}</strong></span>
        <span>·</span>
        <span>Prodáno: <strong className="text-rose-600">{data.summary.sold}</strong></span>
        {data.summary.blocked > 0 && (
          <><span>·</span><span>Blok.: <strong className="text-slate-400">{data.summary.blocked}</strong></span></>
        )}
      </div>
    </div>
  );
}
