import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { AccreditationForm } from './AccreditationForm';

interface EventRow {
  id: string;
  title: string;
  date_start: string | null;
  promoter_name: string | null;
}

async function fetchEvent(eventId: string): Promise<EventRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await db.query<EventRow>(
      `SELECT e.id, e.title, e.date_start, p.name AS promoter_name
       FROM catalog.events e
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE e.id = $1 AND e.status = 'published'`,
      [eventId],
    );
    return r.rows[0] ?? null;
  } finally {
    await db.end();
  }
}

export default async function AccreditationApplyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const event = await fetchEvent(id);
  if (!event) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Žádost o akreditaci</h1>
        <p className="text-sm text-muted-foreground">
          Akce: <strong>{event.title}</strong>
          {event.date_start ? (
            <> · {new Date(event.date_start).toLocaleDateString('cs-CZ')}</>
          ) : null}
          {event.promoter_name ? <> · {event.promoter_name}</> : null}
        </p>
      </div>

      <div className="rounded-md border bg-card p-4 text-xs">
        <strong>Pro koho je akreditace?</strong>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Média — novináři, fotografové, video štáby</li>
          <li>VIP hosté — partneři pořadatele</li>
          <li>Staff — technika, security, catering</li>
          <li>Sponzoři — zástupci sponzorů</li>
          <li>Účinkující — kapely, doprovod</li>
          <li>Hosté — pozvaní hosté pořadatele</li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Po podání pořadatel žádost posoudí (typicky 3–7 dní). Pokud schválí,
          dostaneš vstupenku emailem.
        </p>
      </div>

      <AccreditationForm eventId={event.id} />
    </div>
  );
}
