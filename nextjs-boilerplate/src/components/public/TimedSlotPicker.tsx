'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, ChevronLeft, ChevronRight, Calendar, Users } from 'lucide-react';

interface Slot {
  id: string;
  start: string;
  end: string;
  remaining: number;
  capacity: number;
}

interface DaySlots {
  date: string;
  slots: Slot[];
}

interface Props {
  eventId: string;
  onSlotSelected: (slot: Slot | null) => void;
}

function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('cs-CZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
}

export function TimedSlotPicker({ eventId, onSlotSelected }: Props) {
  const today = todayStr();
  const [windowStart, setWindowStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [days, setDays] = useState<DaySlots[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const WINDOW = 7;
  const windowEnd = addDays(windowStart, WINDOW - 1);

  const loadWindow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/events/${eventId}/entry-slots?days=${WINDOW}&date=${windowStart}`);
      if (!r.ok) throw new Error('Chyba načítání');
      const d = (await r.json()) as { days?: DaySlots[] };
      setDays(d.days ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setLoading(false);
    }
  }, [eventId, windowStart]);

  useEffect(() => {
    void loadWindow();
  }, [loadWindow]);

  function selectSlot(slot: Slot) {
    setSelectedSlot(slot);
    onSlotSelected(slot);
  }

  function clearSlot() {
    setSelectedSlot(null);
    onSlotSelected(null);
  }

  const slotsForDate = days.find((d) => d.date === selectedDate)?.slots ?? [];

  if (selectedSlot) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <Clock className="h-4 w-4" />
              <span>
                {formatDate(selectedDate!)} · {formatLocalTime(selectedSlot.start)} – {formatLocalTime(selectedSlot.end)}
              </span>
            </div>
            <div className="mt-1 text-xs text-emerald-700">
              {selectedSlot.remaining} míst zbývá · kapacita {selectedSlot.capacity}
            </div>
          </div>
          <button
            onClick={clearSlot}
            className="text-xs text-emerald-700 underline hover:no-underline"
          >
            Změnit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-sm font-medium">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        Vyberte datum a čas vstupu
      </div>

      {/* Date window navigation */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setWindowStart(addDays(windowStart, -WINDOW))}
          disabled={windowStart <= today}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs text-muted-foreground">
          {formatDate(windowStart).split(',').pop()?.trim()} – {formatDate(windowEnd).split(',').pop()?.trim()}
        </span>
        <button
          onClick={() => setWindowStart(addDays(windowStart, WINDOW))}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Date chips */}
      {loading ? (
        <div className="py-4 text-center text-xs text-muted-foreground">Načítám dostupné termíny…</div>
      ) : error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: WINDOW }, (_, i) => {
              const d = addDays(windowStart, i);
              const dayData = days.find((x) => x.date === d);
              const hasSlots = dayData && dayData.slots.length > 0;
              const active = selectedDate === d;
              return (
                <button
                  key={d}
                  disabled={!hasSlots}
                  onClick={() => setSelectedDate(d)}
                  className={[
                    'flex min-w-[60px] flex-col items-center rounded-md border px-3 py-2 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary/10 font-semibold text-primary'
                      : hasSlots
                      ? 'border-slate-200 bg-background hover:bg-muted'
                      : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed',
                  ].join(' ')}
                >
                  <span className="font-medium">
                    {new Date(d + 'T00:00:00').toLocaleDateString('cs-CZ', { weekday: 'short' })}
                  </span>
                  <span className="text-[11px]">
                    {new Date(d + 'T00:00:00').toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}
                  </span>
                  {hasSlots ? (
                    <span className="mt-1 text-[10px] text-emerald-600">
                      {dayData.slots.length}×
                    </span>
                  ) : (
                    <span className="mt-1 text-[10px]">—</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Time slots for selected date */}
          {selectedDate ? (
            slotsForDate.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pro vybrané datum nejsou k dispozici žádné termíny.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {slotsForDate.map((slot) => {
                  const pct = Math.round(((slot.capacity - slot.remaining) / slot.capacity) * 100);
                  const almostFull = slot.remaining <= Math.ceil(slot.capacity * 0.1);
                  return (
                    <button
                      key={slot.id}
                      onClick={() => selectSlot(slot)}
                      className="group rounded-md border bg-background p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">
                          {formatLocalTime(slot.start)} – {formatLocalTime(slot.end)}
                        </span>
                        {almostFull ? (
                          <span className="text-[10px] font-medium text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                            Zbývá {slot.remaining}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/50 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          <Users className="inline h-3 w-3 mr-0.5" />
                          {slot.remaining}/{slot.capacity}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Vyberte datum výše pro zobrazení dostupných termínů.</p>
          )}
        </>
      )}
    </div>
  );
}
