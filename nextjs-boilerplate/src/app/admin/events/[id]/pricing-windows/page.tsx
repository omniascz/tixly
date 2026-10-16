'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { CalendarClock, Plus, ArrowUp, ArrowDown } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface TicketType { id: string; name: string; base_price: number; }
interface Window {
  id: string; ticket_type_id: string; ticket_type_name: string;
  name: string;
  starts_at: string; ends_at: string;
  price_override: number | null; price_change_pct: number | null;
  priority: number; enabled: boolean;
}

function fmtKc(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function PricingWindowsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [windows, setWindows] = useState<Window[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ticketTypeId, setTicketTypeId] = useState('');
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [useOverride, setUseOverride] = useState(false);
  const [priceOverrideKc, setPriceOverrideKc] = useState('');
  const [priceChangePct, setPriceChangePct] = useState('-20');
  const [priority, setPriority] = useState('100');

  useEffect(() => { void load(); }, [eventId]);

  async function load(): Promise<void> {
    try {
      const [w, tt] = await Promise.all([
        typedGet<{ windows: Window[] }>(`/api/admin/events/${eventId}/pricing-windows`),
        typedGet<{ ticketTypes: TicketType[] }>(`/api/admin/events/${eventId}/ticket-types`).catch(() => ({ ticketTypes: [] })),
      ]);
      setWindows(w.windows ?? []);
      setTicketTypes(tt.ticketTypes ?? []);
      if (!ticketTypeId && tt.ticketTypes?.length) setTicketTypeId(tt.ticketTypes[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost(`/api/admin/events/${eventId}/pricing-windows`, {
        ticketTypeId, name,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        priceOverride: useOverride ? Math.round(Number(priceOverrideKc) * 100) : undefined,
        priceChangePct: useOverride ? undefined : Number(priceChangePct),
        priority: Number(priority),
      }, { throwOnError: true });
      setShowForm(false);
      setName(''); setStartsAt(''); setEndsAt('');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pricing windows"
        description="Časová okna pro early bird / late surge ceny. Eg. -20 % do 30. 5., +15 % posledních 7 dní."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{windows.length} oken</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nové okno'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nové cenové okno</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Ticket type</label>
              <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {ticketTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({fmtKc(t.base_price)})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Název okna</label>
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="např. Early bird, Last week surge" maxLength={200} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Od</label>
                <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Do</label>
                <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" checked={useOverride} onChange={(e) => setUseOverride(e.target.checked)} />
                Fixní cena místo procent
              </label>
            </div>
            {useOverride ? (
              <div>
                <label className="mb-1 block text-xs font-medium">Fixní cena (Kč)</label>
                <Input type="number" value={priceOverrideKc} onChange={(e) => setPriceOverrideKc(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium">Změna ceny (%) — záporné = sleva</label>
                <Input type="number" step="0.5" value={priceChangePct} onChange={(e) => setPriceChangePct(e.target.value)} />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium">Priorita (vyšší vyhrává při overlapu)</label>
              <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
            <Button onClick={create} disabled={busy || !name || !startsAt || !endsAt}>
              <Plus className="mr-1 h-4 w-4" /> {busy ? 'Ukládám…' : 'Aktivovat'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {windows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <CalendarClock className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádná cenová okna. Vytvoř early bird s -20 % pro první týden a late surge s +15 % pro poslední dny.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {windows.map((w) => {
            const isActive = new Date(w.starts_at) <= new Date() && new Date(w.ends_at) > new Date();
            return (
              <Card key={w.id} className={isActive ? 'border-emerald-300' : w.enabled ? '' : 'opacity-60'}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{w.name}</p>
                      <p className="text-xs text-muted-foreground">{w.ticket_type_name}</p>
                      <p className="mt-1 text-xs">
                        {new Date(w.starts_at).toLocaleDateString('cs-CZ')} – {new Date(w.ends_at).toLocaleDateString('cs-CZ')}
                      </p>
                    </div>
                    <div className="text-right">
                      {w.price_override !== null ? (
                        <p className="font-bold">{fmtKc(w.price_override)}</p>
                      ) : (
                        <p className="font-bold">
                          {Number(w.price_change_pct) > 0 ? (
                            <span className="text-rose-700">
                              <ArrowUp className="inline h-4 w-4" /> +{w.price_change_pct} %
                            </span>
                          ) : (
                            <span className="text-emerald-700">
                              <ArrowDown className="inline h-4 w-4" /> {w.price_change_pct} %
                            </span>
                          )}
                        </p>
                      )}
                      {isActive ? <p className="text-xs text-emerald-700">🟢 Aktivní</p> : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
