import { notFound } from 'next/navigation';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { KioskCheckoutClient } from './KioskCheckoutClient';

interface TicketTypeRow {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  remaining_qty: number;
  currency: string;
}

interface EventRow {
  id: string;
  title: string;
  currency: string;
  promoter_slug: string;
}

async function getData(slug: string, eventId: string) {
  return runWithServiceContext(async () => {
    const evRes = await db().query<EventRow>(
      `SELECT e.id, e.title, e.currency, p.slug AS promoter_slug
         FROM catalog.events e
         JOIN platform.promoters p ON p.id = e.promoter_id
        WHERE e.id = $1
          AND p.slug = $2
          AND e.status = 'published'
          AND e.starts_at > NOW()`,
      [eventId, slug],
    );
    const ev = evRes.rows[0];
    if (!ev) return null;

    const ttRes = await db().query<TicketTypeRow>(
      `SELECT id, name, description, base_price, remaining_qty, $1::text AS currency
         FROM catalog.ticket_types
        WHERE event_id = $2
          AND is_active = true
          AND remaining_qty > 0
          AND is_seated = false
        ORDER BY base_price ASC`,
      [ev.currency, eventId],
    );

    return { ev, ticketTypes: ttRes.rows };
  });
}

export default async function KioskEventPage({ params }: { params: { slug: string; eventId: string } }) {
  const data = await getData(params.slug, params.eventId);
  if (!data || data.ticketTypes.length === 0) notFound();

  return (
    <KioskCheckoutClient
      promoterSlug={params.slug}
      eventId={params.eventId}
      eventTitle={data.ev.title}
      ticketTypes={data.ticketTypes}
      currency={data.ev.currency}
    />
  );
}
