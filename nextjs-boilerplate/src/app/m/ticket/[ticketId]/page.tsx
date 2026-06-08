/**
 * /m/ticket/[ticketId] — Mobile-first fullscreen ticket view.
 *
 * TM-style: minimální chrome, velký QR, Apple/Google Wallet buttons,
 * lock-screen optimized brightness, transfer button.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth';
import { db as rlsDb, runWithUserContext } from '@/lib/db/rls-pool';
import { MobileTicketView } from './MobileTicketView';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ ticketId: string }>;
}

export default async function MobileTicketPage({ params }: PageProps): Promise<JSX.Element> {
  const { ticketId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('session_jwt')?.value ?? cookieStore.get('buyer_jwt')?.value;
  if (!token) redirect(`/cs/login?next=/m/ticket/${ticketId}`);

  let userId: string;
  try {
    const payload = await verifyToken(token);
    userId = (payload.sub as string) ?? '';
  } catch {
    redirect(`/cs/login?next=/m/ticket/${ticketId}`);
  }

  // Pod ENFORCED RLS musí být user kontext nastaven, jinak tickets RLS vrátí 0.
  // userId odvozen z session/buyer JWT výše; WHERE t.owner_id = $2 je belt-and-suspenders.
  const r = await runWithUserContext(userId, () =>
    rlsDb().query<{
      id: string;
      event_title: string;
      event_date: string;
      venue_name: string | null;
      ticket_type_name: string;
      holder_name: string | null;
      holder_email: string;
      brand_color_hex: string | null;
      promoter_name: string | null;
      sector: string | null;
      row_label: string | null;
      seat_number: string | null;
      status: string;
    }>(
      `SELECT t.id, e.title AS event_title, e.date_start::text AS event_date,
            v.name AS venue_name, tt.name AS ticket_type_name,
            u.name AS holder_name, u.email AS holder_email,
            p.brand_color_hex, p.name AS promoter_name,
            es.sector, es.row AS row_label, es.seat_number,
            t.status
       FROM tickets.tickets t
       JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
       JOIN orders.orders o ON o.id = t.order_id
       JOIN catalog.events e ON e.id = o.event_id
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
  LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       JOIN identity.users u ON u.id = t.owner_id
  LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
      WHERE t.id = $1 AND t.owner_id = $2`,
      [ticketId, userId],
    ),
  );

  if (r.rows.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="text-2xl">⚠️</p>
          <p className="mt-2 font-semibold">Lístek nenalezen</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Lístek neexistuje nebo nepatří tvému účtu.
          </p>
        </div>
      </div>
    );
  }
  const t = r.rows[0];

  const seatLabel = t.sector
    ? `${t.sector} · řada ${t.row_label ?? '?'} · sedadlo ${t.seat_number ?? '?'}`
    : null;

  return (
    <MobileTicketView
      ticketId={t.id}
      eventTitle={t.event_title}
      eventDate={t.event_date}
      venueName={t.venue_name}
      ticketTypeName={t.ticket_type_name}
      holderName={t.holder_name ?? t.holder_email}
      brandColor={t.brand_color_hex ?? '#6C47FF'}
      promoterName={t.promoter_name ?? 'Tixly'}
      seatLabel={seatLabel}
      status={t.status}
    />
  );
}
