import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { SlotPickerClient } from './SlotPickerClient';

interface EventRow {
  id: string;
  title: string;
  timed_entry_enabled: boolean;
}

async function fetchEvent(eventId: string): Promise<EventRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await db.query<EventRow>(
      `SELECT id, title, COALESCE(timed_entry_enabled, FALSE) AS timed_entry_enabled
       FROM catalog.events
       WHERE id = $1 AND status = 'published'`,
      [eventId],
    );
    return r.rows[0] ?? null;
  } finally {
    await db.end();
  }
}

export default async function SlotsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id, locale } = await params;
  const event = await fetchEvent(id);
  if (!event) notFound();

  if (!event.timed_entry_enabled) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Tato akce není timed-entry. Vstup je platný kdykoli během doby konání.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Vyber čas vstupu</h1>
        <p className="text-sm text-muted-foreground">
          {event.title} — vyber konkrétní časový slot. Kapacita je omezená.
        </p>
      </div>
      <SlotPickerClient eventId={event.id} locale={locale} />
    </div>
  );
}
