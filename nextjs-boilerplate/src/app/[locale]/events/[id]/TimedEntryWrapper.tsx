'use client';

import { useState } from 'react';
import { TimedSlotPicker } from '@/components/public/TimedSlotPicker';
import { TicketPicker, type TicketTypeWithAccess, type PickerDay, type PickerZone } from './TicketPicker';

interface Slot {
  id: string;
  start: string;
  end: string;
  remaining: number;
  capacity: number;
}

interface Props {
  eventId: string;
  locale: string;
  currency?: string;
  queueEnabled?: boolean;
  ticketTypes: TicketTypeWithAccess[];
  days: PickerDay[];
  zones: PickerZone[];
  t?: {
    buy: string;
    soldOut: string;
    available: string;
    day: string;
    zone: string;
    all: string;
    filterCount: string;
    noMatch: string;
  };
}

export function TimedEntryWrapper({ eventId, locale, currency, queueEnabled, ticketTypes, days, zones, t }: Props) {
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  return (
    <div className="space-y-4">
      <TimedSlotPicker eventId={eventId} onSlotSelected={setSelectedSlot} />

      {selectedSlot ? (
        <div className="border-t pt-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">Zvolte typ vstupenky:</p>
          <TicketPicker
            eventId={eventId}
            locale={locale}
            currency={currency}
            queueEnabled={queueEnabled}
            ticketTypes={ticketTypes}
            days={days}
            zones={zones}
            t={t}
            entrySlotId={selectedSlot.id}
          />
        </div>
      ) : null}
    </div>
  );
}
