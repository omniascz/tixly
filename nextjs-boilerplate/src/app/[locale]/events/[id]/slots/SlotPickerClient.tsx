'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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

export function SlotPickerClient({ eventId, locale }: { eventId: string; locale: string }) {
  const [days, setDays] = useState<DaySlots[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  useEffect(() => {
    void load();
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/events/${eventId}/entry-slots?days=14`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const j = (await res.json()) as { days: DaySlots[] };
        setDays(j.days);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [eventId]);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
        {error}
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Žádné dostupné sloty v příštích 14 dnech.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <Card key={day.date}>
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
              {new Date(day.date).toLocaleDateString('cs-CZ', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {day.slots.map((slot) => {
                const isSelected = selectedSlot?.id === slot.id;
                const isFull = slot.remaining === 0;
                const fillPct = Math.round(((slot.capacity - slot.remaining) / slot.capacity) * 100);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    disabled={isFull}
                    onClick={() => setSelectedSlot(slot)}
                    className={`flex flex-col items-center rounded-md border p-2 text-xs transition ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-300'
                        : isFull
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:bg-muted'
                    }`}
                  >
                    <div className="font-mono text-base">
                      {new Date(slot.start).toLocaleTimeString('cs-CZ', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Europe/Prague',
                      })}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {isFull
                        ? 'Plno'
                        : slot.remaining > 10
                          ? `${slot.remaining} volných`
                          : `Zbývá ${slot.remaining}`}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
                      <div
                        className={`h-full ${
                          fillPct >= 90
                            ? 'bg-rose-500'
                            : fillPct >= 70
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        }`}
                        style={{ width: `${fillPct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      {selectedSlot ? (
        <div className="sticky bottom-0 rounded-md border bg-card p-4 shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Vybraný slot</div>
              <div className="text-sm font-semibold">
                {new Date(selectedSlot.start).toLocaleString('cs-CZ', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Europe/Prague',
                })}
              </div>
            </div>
            <Button
              onClick={() => {
                const params = new URLSearchParams({
                  eventId,
                  entrySlotId: selectedSlot.id,
                  quantity: '1',
                });
                window.location.href = `/${locale}/checkout?${params.toString()}`;
              }}
            >
              Pokračovat k objednávce →
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
