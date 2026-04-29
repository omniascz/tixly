'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, ScanLine, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

type ScanResult = {
  result:
    | 'admitted'
    | 'already_used'
    | 'already_redeemed_today'
    | 'revoked'
    | 'not_found'
    | 'wrong_promoter'
    | 'totp_mismatch'
    | 'invalid_status'
    | 'wrong_zone_or_day'
    | 'flex_limit_exhausted'
    | 'day_not_picked'
    | 'error';
  kind?: 'single_use' | 'multi_day_redemption';
  message?: string;
  usedAt?: string;
  revokedAt?: string;
  admittedAt?: string;
  picksRequired?: number;
  picksUsed?: number;
  ticket?: {
    ticketId: string;
    eventTitle: string;
    ticketTypeName: string;
    holderEmail: string;
    holderName: string | null;
  };
};

interface GateEvent {
  id: string;
  title: string;
  dateStart: string;
  days: { id: string; label: string | null; startsAt: string; dayIndex: number }[];
  zones: { id: string; name: string; zoneType: string }[];
}

interface GateState {
  eventId: string | null;
  eventDayId: string | null;
  zoneId: string | null;
}

const STORAGE_KEY = 'tixly.scanner.gate';

export default function ScannerPage() {
  const [ticketId, setTicketId] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [gate, setGate] = useState<GateState>({ eventId: null, eventDayId: null, zoneId: null });
  const [showSettings, setShowSettings] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GateState;
        setGate(parsed);
        setShowSettings(false);
      }
    } catch {
      // ignore
    }
    void loadGates();
  }, []);

  async function loadGates() {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/admin/scanner/gates', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const json = (await res.json()) as { events: GateEvent[] };
      setEvents(json.events);
    } catch {
      // ignore
    }
  }

  function persistGate(next: GateState) {
    setGate(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  const selectedEvent = events.find((e) => e.id === gate.eventId) ?? null;
  const selectedDay = selectedEvent?.days.find((d) => d.id === gate.eventDayId) ?? null;
  const selectedZone = selectedEvent?.zones.find((z) => z.id === gate.zoneId) ?? null;
  const gateLabel = selectedEvent
    ? `${selectedEvent.title}${selectedDay ? ' · ' + (selectedDay.label ?? `Den ${selectedDay.dayIndex + 1}`) : ''}${selectedZone ? ' · ' + selectedZone.name : ''}`
    : 'Žádná brána zvolena';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem('accessToken');
      const body: Record<string, string> = { ticketId: ticketId.trim() };
      if (totpCode.trim()) body.totpCode = totpCode.trim();
      if (gate.eventDayId) body.eventDayId = gate.eventDayId;
      if (gate.zoneId) body.zoneId = gate.zoneId;
      const res = await fetch('/api/admin/scanner/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as ScanResult;
      setResult({ ...data, result: data.result ?? 'error' });
      if (res.ok && data.result === 'admitted') {
        setTicketId('');
        setTotpCode('');
      }
    } catch {
      setResult({ result: 'error', message: 'Síťová chyba' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scanner"
        description="Manuální validace QR lístku. Pro festivaly nastav bránu (akce + den + zóna) a scanner bude validovat per gate."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" aria-hidden /> Brána
            </span>
            <button
              type="button"
              className="text-xs font-normal text-primary hover:underline"
              onClick={() => setShowSettings((s) => !s)}
            >
              {showSettings ? 'Skrýt' : 'Změnit'}
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!showSettings ? (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{gateLabel}</span>
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Načítání akcí… Pokud nemáš žádnou nadcházející akci, vytvoř ji
              v sekci „Akce".
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Akce
                </label>
                <select
                  value={gate.eventId ?? ''}
                  onChange={(e) =>
                    persistGate({
                      eventId: e.target.value || null,
                      eventDayId: null,
                      zoneId: null,
                    })
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— vyber akci —</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({new Date(ev.dateStart).toLocaleDateString('cs-CZ')})
                    </option>
                  ))}
                </select>
              </div>

              {selectedEvent && selectedEvent.days.length > 0 ? (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                    Den{selectedEvent.days.length > 1 ? ' (povinné pro multi-day)' : ''}
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <ChipButton
                      active={gate.eventDayId === null}
                      onClick={() => persistGate({ ...gate, eventDayId: null })}
                      label="Vše"
                    />
                    {selectedEvent.days.map((d) => (
                      <ChipButton
                        key={d.id}
                        active={gate.eventDayId === d.id}
                        onClick={() => persistGate({ ...gate, eventDayId: d.id })}
                        label={
                          d.label ??
                          new Date(d.startsAt).toLocaleDateString('cs-CZ', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedEvent && selectedEvent.zones.length > 0 ? (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                    Zóna / scéna
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <ChipButton
                      active={gate.zoneId === null}
                      onClick={() => persistGate({ ...gate, zoneId: null })}
                      label="Vše"
                    />
                    {selectedEvent.zones.map((z) => (
                      <ChipButton
                        key={z.id}
                        active={gate.zoneId === z.id}
                        onClick={() => persistGate({ ...gate, zoneId: z.id })}
                        label={z.name}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowSettings(false)}
                >
                  Hotovo
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" aria-hidden /> Validace
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Ticket ID (UUID)</label>
                <Input
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  placeholder="8a4f7b2e-..."
                  required
                  pattern="[0-9a-fA-F-]{36}"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  TOTP kód (volitelné, z autentikační appky)
                </label>
                <Input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="123456"
                  pattern="\d{6}"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Validuji…' : 'Validovat lístek'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Výsledek</CardTitle>
          </CardHeader>
          <CardContent>{renderResult(result)}</CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChipButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
          : 'rounded-full border bg-background px-3 py-1 text-xs font-medium hover:bg-muted'
      }
    >
      {label}
    </button>
  );
}

function renderResult(r: ScanResult | null) {
  if (!r) {
    return (
      <p className="text-sm text-muted-foreground">
        Naskenuj nebo vlož ticket ID, abys viděl výsledek.
      </p>
    );
  }
  if (r.result === 'admitted') {
    return (
      <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3">
        <div className="flex items-center gap-2 text-emerald-900">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-semibold">
            Vstup povolen
            {r.kind === 'multi_day_redemption' ? ' (multi-day)' : ''}
          </span>
        </div>
        {r.ticket ? <TicketDetails t={r.ticket} /> : null}
        {r.admittedAt ? (
          <p className="text-xs text-emerald-700">
            Přijat: {new Date(r.admittedAt).toLocaleString('cs-CZ')}
          </p>
        ) : null}
      </div>
    );
  }
  if (r.result === 'already_used' || r.result === 'already_redeemed_today') {
    return (
      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
        <div className="flex items-center gap-2 text-amber-900">
          <AlertTriangle className="h-5 w-5" />
          <span className="font-semibold">
            {r.result === 'already_redeemed_today'
              ? 'Pro tento den už použito'
              : 'Lístek už byl použit'}
          </span>
        </div>
        {r.ticket ? <TicketDetails t={r.ticket} /> : null}
        {r.usedAt ? (
          <p className="text-xs text-amber-800">
            Použit: {new Date(r.usedAt).toLocaleString('cs-CZ')}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-rose-300 bg-rose-50 p-3">
      <div className="flex items-center gap-2 text-rose-900">
        <XCircle className="h-5 w-5" />
        <span className="font-semibold">{labelFor(r.result)}</span>
      </div>
      {r.message ? <p className="text-sm text-rose-800">{r.message}</p> : null}
      {r.picksRequired !== undefined && r.picksUsed !== undefined ? (
        <p className="text-xs text-rose-800">
          Flex pass: {r.picksUsed}/{r.picksRequired} dní vyčerpáno
        </p>
      ) : null}
      {r.ticket ? <TicketDetails t={r.ticket} /> : null}
    </div>
  );
}

function TicketDetails({ t }: { t: NonNullable<ScanResult['ticket']> }) {
  return (
    <div className="text-sm text-foreground">
      <div className="font-medium">{t.eventTitle}</div>
      <div className="text-xs text-muted-foreground">{t.ticketTypeName}</div>
      <div className="text-xs text-muted-foreground">
        {t.holderName ? `${t.holderName} · ` : ''}
        {t.holderEmail}
      </div>
    </div>
  );
}

function labelFor(r: ScanResult['result']): string {
  switch (r) {
    case 'revoked':
      return 'Lístek zrušen';
    case 'not_found':
      return 'Lístek nenalezen';
    case 'wrong_promoter':
      return 'Lístek jiného promotéra';
    case 'totp_mismatch':
      return 'TOTP kód neodpovídá';
    case 'invalid_status':
      return 'Neplatný stav';
    case 'wrong_zone_or_day':
      return 'Lístek nemá přístup do této zóny / dne';
    case 'flex_limit_exhausted':
      return 'Flex pass vyčerpán';
    case 'day_not_picked':
      return 'Tento den není mezi vybranými termíny';
    default:
      return 'Chyba';
  }
}
