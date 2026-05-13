'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney, isCurrency } from '@/lib/format';
import { useRouter } from 'next/navigation';

export interface TicketAccess {
  event_day_id: string | null;
  zone_id: string | null;
  access_level: string;
}

export interface TicketTypeWithAccess {
  id: string;
  name: string;
  base_price: number;
  available: number;
  access: TicketAccess[];
  is_seated?: boolean;
  visibility?: 'public' | 'access_code' | 'hidden';
}

export interface PickerDay {
  id: string;
  label: string | null;
  starts_at: string;
}

export interface PickerZone {
  id: string;
  name: string;
  zone_type: string;
}

interface PickerDict {
  buy: string;
  soldOut: string;
  available: string;
  day: string;
  zone: string;
  all: string;
  filterCount: string;
  noMatch: string;
}

interface Props {
  eventId: string;
  locale: string;
  currency?: string;
  queueEnabled?: boolean;
  ticketTypes: TicketTypeWithAccess[];
  days: PickerDay[];
  zones: PickerZone[];
  t?: PickerDict;
}

const FALLBACK: PickerDict = {
  buy: 'Koupit',
  soldOut: 'Vyprodáno',
  available: 'dostupných',
  day: 'Den',
  zone: 'Zóna / scéna',
  all: 'Vše',
  filterCount: 'odpovídá filtru',
  noMatch: 'Žádná vstupenka pro vybraný den/zónu.',
};

function matches(tt: TicketTypeWithAccess, dayId: string | null, zoneId: string | null): boolean {
  if (tt.access.length === 0) return true;
  return tt.access.some((a) => {
    const dayOk = a.event_day_id === null || dayId === null || a.event_day_id === dayId;
    const zoneOk = a.zone_id === null || zoneId === null || a.zone_id === zoneId;
    return dayOk && zoneOk;
  });
}

function summarize(tt: TicketTypeWithAccess, days: PickerDay[], zones: PickerZone[]): string | null {
  if (tt.access.length === 0) return null;
  const dayMap = new Map(days.map((d) => [d.id, d.label ?? new Date(d.starts_at).toLocaleDateString('cs-CZ')]));
  const zoneMap = new Map(zones.map((z) => [z.id, z.name]));
  const parts = tt.access.map((a) => {
    const dayLabel = a.event_day_id === null ? 'všechny dny' : (dayMap.get(a.event_day_id) ?? '?');
    const zoneLabel = a.zone_id === null ? 'všechny zóny' : (zoneMap.get(a.zone_id) ?? '?');
    return `${dayLabel} · ${zoneLabel}`;
  });
  return parts.join(' / ');
}

export function TicketPicker({ eventId, locale, currency, queueEnabled, ticketTypes, days, zones, t }: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const ccy = isCurrency(currency) ? currency : 'CZK';
  const dict = t ?? FALLBACK;

  // Access code unlock state
  const [showAccessInput, setShowAccessInput] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);
  const [unlockMessage, setUnlockMessage] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const hasAccessGated = ticketTypes.some((tt) => tt.visibility === 'access_code');

  const showFilters = days.length > 1 || zones.length > 1;

  const visible = useMemo(
    () =>
      ticketTypes.filter(
        (tt) => tt.visibility !== 'access_code' || unlockedIds.includes(tt.id),
      ),
    [ticketTypes, unlockedIds],
  );

  const filtered = useMemo(
    () => visible.filter((tt) => matches(tt, selectedDay, selectedZone)),
    [visible, selectedDay, selectedZone],
  );

  async function handleUnlock() {
    setUnlockError(null);
    setUnlockMessage(null);
    setUnlocking(true);
    try {
      const res = await fetch(`/api/events/${eventId}/unlock-access-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: accessCode.trim() }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        ticketTypeIds?: string[];
        ticketTypeNames?: string[];
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.success) {
        setUnlockError(data.message ?? 'Neplatný kód.');
        return;
      }
      const newIds = (data.ticketTypeIds ?? []).filter((id) => !unlockedIds.includes(id));
      setUnlockedIds((prev) => Array.from(new Set([...prev, ...(data.ticketTypeIds ?? [])])));
      const names = data.ticketTypeNames ?? [];
      setUnlockMessage(
        newIds.length === 0
          ? 'Kód platný, ale již byl použit (lístky jsou odemčené).'
          : `Odemčeno: ${names.join(', ')}`,
      );
      setAccessCode('');
    } catch (e) {
      setUnlockError(e instanceof Error ? e.message : 'Síťová chyba');
    } finally {
      setUnlocking(false);
    }
  }

  function buy(tt: TicketTypeWithAccess) {
    setLoading(tt.id);
    const params = new URLSearchParams({ eventId, ticketTypeId: tt.id });
    if (selectedDay) params.set('eventDayId', selectedDay);
    if (selectedZone) params.set('zoneId', selectedZone);
    let target: string;
    if (tt.is_seated) {
      target = `/${locale}/events/${eventId}/seats?${params.toString()}`;
    } else if (queueEnabled) {
      target = `/${locale}/queue/${eventId}?${params.toString()}`;
    } else {
      target = `/${locale}/checkout?${params.toString()}`;
    }
    router.push(target);
  }

  return (
    <div className="space-y-3">
      {showFilters ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {days.length > 1 ? (
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                {dict.day}
              </div>
              <div className="flex flex-wrap gap-1">
                <FilterChip
                  active={selectedDay === null}
                  onClick={() => setSelectedDay(null)}
                  label={dict.all}
                />
                {days.map((d) => (
                  <FilterChip
                    key={d.id}
                    active={selectedDay === d.id}
                    onClick={() => setSelectedDay(d.id)}
                    label={d.label ?? new Date(d.starts_at).toLocaleDateString(locale === 'cs' ? 'cs-CZ' : locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {zones.length > 1 ? (
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                {dict.zone}
              </div>
              <div className="flex flex-wrap gap-1">
                <FilterChip
                  active={selectedZone === null}
                  onClick={() => setSelectedZone(null)}
                  label={dict.all}
                />
                {zones.map((z) => (
                  <FilterChip
                    key={z.id}
                    active={selectedZone === z.id}
                    onClick={() => setSelectedZone(z.id)}
                    label={z.name}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">
            {filtered.length} / {ticketTypes.length} {dict.filterCount}
          </div>
        </div>
      ) : null}

      {/* Access code unlock — viditelné jen pokud event má aspoň 1 ticket type s visibility='access_code' */}
      {hasAccessGated ? (
        <div className="rounded-md border bg-amber-50/30 p-3 text-sm">
          {!showAccessInput ? (
            <button
              type="button"
              onClick={() => setShowAccessInput(true)}
              className="text-xs font-medium text-amber-900 hover:underline"
            >
              Mám předprodejní / VIP kód
            </button>
          ) : (
            <div className="space-y-2">
              <label htmlFor="access-code-input" className="block text-xs font-medium">
                Předprodejní / VIP kód
              </label>
              <div className="flex gap-2">
                <input
                  id="access-code-input"
                  type="text"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                  placeholder="např. CLENOVE2026"
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm uppercase"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleUnlock()}
                  disabled={unlocking || accessCode.length < 3}
                >
                  {unlocking ? '…' : 'Odemknout'}
                </Button>
              </div>
              {unlockMessage ? (
                <p className="text-xs text-emerald-700">{unlockMessage}</p>
              ) : null}
              {unlockError ? (
                <p className="text-xs text-rose-700">{unlockError}</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-md border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
          {dict.noMatch}
        </p>
      ) : (
        filtered.map((tt) => {
          const summary = summarize(tt, days, zones);
          const showSummary = summary && (days.length > 1 || zones.length > 1);
          return (
            <div key={tt.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{tt.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {tt.available > 0 ? `${tt.available} ${dict.available}` : dict.soldOut}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatMoney(tt.base_price, ccy)}</div>
                  {tt.available > 0 ? (
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={loading === tt.id}
                      onClick={() => buy(tt)}
                    >
                      {loading === tt.id ? '...' : dict.buy}
                    </Button>
                  ) : (
                    <WaitlistButton eventId={eventId} ticketTypeId={tt.id} />
                  )}
                </div>
              </div>
              {showSummary ? (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted/40 px-1.5 py-0.5">
                    {summary}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function WaitlistButton({ eventId, ticketTypeId }: { eventId: string; ticketTypeId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticketTypeId, email, name: name || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        position?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setPosition(j.position ?? null);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="mt-2 text-xs text-emerald-700">
        Na waitlistu{position ? ` (#${position})` : ''}. Pošleme e-mail.
      </p>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
        Waitlist
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-1 text-left">
      <input
        type="email"
        placeholder="E-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded border bg-background px-2 py-1 text-xs"
      />
      <input
        placeholder="Jméno (volitelné)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded border bg-background px-2 py-1 text-xs"
      />
      <Button size="sm" disabled={busy || !email} onClick={join}>
        {busy ? 'Přihlašuji…' : 'Přihlásit na waitlist'}
      </Button>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}

function FilterChip({
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
