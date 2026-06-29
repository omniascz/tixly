'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Plus, Trash2, Power, Settings } from 'lucide-react';
import { EventDetailNav } from '@/app/admin/events/[id]/EventDetailNav';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Slot {
  id: string;
  slot_start: string;
  slot_end: string;
  capacity: number;
  remaining: number;
  status: 'open' | 'sold_out' | 'cancelled';
  notes?: string;
  created_at: string;
}

const authFetch = (url: string, opts?: RequestInit) =>
  fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${typeof localStorage !== 'undefined' ? (localStorage.getItem('accessToken') ?? '') : ''}`,
      ...(opts?.headers ?? {}),
    },
  });

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  });
}

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Prague',
  });
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Otevřen',
  sold_out: 'Vyprodán',
  cancelled: 'Zrušen',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-emerald-100 text-emerald-800',
  sold_out: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-slate-200 text-slate-600',
};

export default function EntrySlotsPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showGenerator, setShowGenerator] = useState(false);
  const [editCapacity, setEditCapacity] = useState<Record<string, string>>({});

  // Generátor form
  const today = todayStr();
  const [gStartDate, setGStartDate] = useState(today);
  const [gEndDate, setGEndDate] = useState(addDays(today, 30));
  const [gDailyStart, setGDailyStart] = useState('09:00');
  const [gDailyEnd, setGDailyEnd] = useState('17:00');
  const [gDuration, setGDuration] = useState(60);
  const [gBuffer, setGBuffer] = useState(0);
  const [gCapacity, setGCapacity] = useState(50);
  const [gDays, setGDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/entry-slots`);
      const d = (await r.json()) as { slots?: Slot[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setSlots(d.slots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function patch(slotId: string, body: Record<string, unknown>) {
    setBusy(slotId);
    await authFetch(`/api/admin/events/${eventId}/entry-slots/${slotId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setBusy(null);
    await load();
  }

  async function del(slotId: string) {
    if (!confirm('Smazat slot?')) return;
    setBusy(slotId);
    const r = await authFetch(`/api/admin/events/${eventId}/entry-slots/${slotId}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = (await r.json()) as { error?: string; sold?: number };
      alert(d.error === 'SLOT_HAS_SALES' ? `Slot má ${d.sold} prodaných vstupenek — nelze smazat, zruš ho místo toho.` : d.error ?? 'Chyba');
    }
    setBusy(null);
    await load();
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/entry-slots`, {
        method: 'POST',
        body: JSON.stringify({
          startDate: gStartDate,
          endDate: gEndDate,
          dailyStart: gDailyStart,
          dailyEnd: gDailyEnd,
          slotDurationMinutes: gDuration,
          bufferMinutes: gBuffer,
          capacityPerSlot: gCapacity,
          daysOfWeek: gDays,
        }),
      });
      const d = (await r.json()) as { ok?: boolean; attempted?: number; error?: string };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setShowGenerator(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba při generování');
    } finally {
      setGenerating(false);
    }
  }

  // Group slots by date
  const byDate = slots.reduce<Record<string, Slot[]>>((acc, s) => {
    const d = new Date(s.slot_start)
      .toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
    (acc[d] ??= []).push(s);
    return acc;
  }, {});

  const totalCapacity = slots.reduce((sum, s) => sum + s.capacity, 0);
  const totalSold = slots.reduce((sum, s) => sum + (s.capacity - s.remaining), 0);

  const DAYS_CZ = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

  return (
    <div>
      <EventDetailNav eventId={eventId} />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Časové vstupy (Timed Entry)"
          description="Správa časových slotů pro muzea, výstavy a prohlídky s omezenou kapacitou."
        />

        {error ? (
          <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span><strong>{slots.length}</strong> slotů celkem</span>
            <span><strong>{totalSold}</strong> / {totalCapacity} míst obsazeno</span>
            <span><strong>{slots.filter((s) => s.status === 'open').length}</strong> otevřených</span>
          </div>
          <Button onClick={() => setShowGenerator(!showGenerator)}>
            <Plus className="mr-1 h-4 w-4" />
            Generovat sloty
          </Button>
        </div>

        {/* Generator form */}
        {showGenerator ? (
          <Card>
            <CardHeader><CardTitle>Generovat časové sloty</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium">Od data</label>
                  <Input type="date" value={gStartDate} onChange={(e) => setGStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Do data</label>
                  <Input type="date" value={gEndDate} onChange={(e) => setGEndDate(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Provozní hodiny — od</label>
                  <Input type="time" value={gDailyStart} onChange={(e) => setGDailyStart(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">do</label>
                  <Input type="time" value={gDailyEnd} onChange={(e) => setGDailyEnd(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Délka slotu (min)</label>
                  <Input type="number" min={10} max={480} value={gDuration} onChange={(e) => setGDuration(Number(e.target.value))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Buffer mezi sloty (min)</label>
                  <Input type="number" min={0} max={120} value={gBuffer} onChange={(e) => setGBuffer(Number(e.target.value))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Kapacita / slot</label>
                  <Input type="number" min={1} value={gCapacity} onChange={(e) => setGCapacity(Number(e.target.value))} />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium">Dny v týdnu</label>
                <div className="flex gap-2">
                  {DAYS_CZ.map((label, idx) => (
                    <label key={idx} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={gDays.includes(idx)}
                        onChange={(e) =>
                          setGDays((prev) => e.target.checked ? [...prev, idx] : prev.filter((d) => d !== idx))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={generate} disabled={generating}>
                  {generating ? 'Generuji…' : 'Generovat'}
                </Button>
                <Button variant="outline" onClick={() => setShowGenerator(false)}>Zrušit</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Slot list by date */}
        {loading ? (
          <p className="text-sm text-muted-foreground">Načítám sloty…</p>
        ) : slots.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Žádné sloty. Klikni na „Generovat sloty" pro vytvoření časového rozvrhu.
            </CardContent>
          </Card>
        ) : (
          Object.entries(byDate).map(([date, dateSlots]) => (
            <Card key={date}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{formatDateFull(date + 'T00:00:00')}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {dateSlots.length} slotů · {dateSlots.reduce((s, x) => s + x.capacity - x.remaining, 0)}/{dateSlots.reduce((s, x) => s + x.capacity, 0)} obsazeno
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {dateSlots.map((slot) => {
                    const sold = slot.capacity - slot.remaining;
                    const pct = Math.round((sold / slot.capacity) * 100);
                    return (
                      <div key={slot.id} className={`rounded-md border p-3 ${slot.status === 'cancelled' ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm">
                                {formatTime(slot.slot_start)} – {formatTime(slot.slot_end)}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[slot.status] ?? ''}`}>
                                {STATUS_LABEL[slot.status] ?? slot.status}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {sold} / {slot.capacity} ({pct}%)
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {/* Inline capacity edit */}
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                className="h-7 w-16 text-xs"
                                value={editCapacity[slot.id] ?? slot.capacity}
                                min={sold > 0 ? sold : 1}
                                onChange={(e) => setEditCapacity((p) => ({ ...p, [slot.id]: e.target.value }))}
                              />
                              {editCapacity[slot.id] && editCapacity[slot.id] !== String(slot.capacity) ? (
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  disabled={busy === slot.id}
                                  onClick={() => {
                                    void patch(slot.id, { capacity: Number(editCapacity[slot.id]) });
                                    setEditCapacity((p) => { const n = { ...p }; delete n[slot.id]; return n; });
                                  }}
                                >
                                  <Settings className="h-3 w-3" />
                                </Button>
                              ) : null}
                            </div>
                            <button
                              onClick={() => void patch(slot.id, { status: slot.status === 'cancelled' ? 'open' : 'cancelled' })}
                              disabled={busy === slot.id}
                              className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                              title={slot.status === 'cancelled' ? 'Znovu otevřít' : 'Zrušit'}
                            >
                              <Power className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => void del(slot.id)}
                              disabled={busy === slot.id || sold > 0}
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                              title={sold > 0 ? 'Má prodeje' : 'Smazat'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
