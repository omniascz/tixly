import { db as rlsDb } from '@/lib/db/rls-pool';
import { runAsServerPromoter } from '@/lib/server-session';
import Link from 'next/link';
import { ArrowRight, User, RefreshCw, ShoppingBag, ScanLine, Send } from 'lucide-react';

interface ChainEvent {
  event_type: string;
  actor: string;
  details: string;
  timestamp: string;
}

interface TicketInfo {
  ticket_id: string;
  event_title: string;
  current_holder_email: string;
  current_holder_name: string | null;
  status: string;
  used_at: string | null;
  promoter_id: string;
}

async function fetchTicketChain(
  ticketId: string,
  promoterId: string,
): Promise<{ ticket: TicketInfo; chain: ChainEvent[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return null;
  // Volá se uvnitř runAsServerPromoter (kontext už nastaven) → db() je promoter-scoped.
  try {
    // Verify ownership
    const ticketRes = await rlsDb().query<TicketInfo>(
      `SELECT t.id AS ticket_id, e.title AS event_title,
              u.email AS current_holder_email,
              u.name AS current_holder_name,
              t.status, t.used_at::text, e.promoter_id::text
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN catalog.events e ON e.id = o.event_id
         JOIN identity.users u ON u.id = t.owner_id
        WHERE t.id = $1 AND e.promoter_id = $2`,
      [ticketId, promoterId],
    );
    if (ticketRes.rows.length === 0) return null;
    const ticket = ticketRes.rows[0];

    // Aggregate chain: order → transfer log → resale → scan
    const chain: ChainEvent[] = [];

    // 1. Original purchase
    const orderRes = await rlsDb().query<{ created_at: string; buyer_email: string }>(
      `SELECT o.created_at::text, u.email AS buyer_email
         FROM orders.orders o
         JOIN tickets.tickets t ON t.order_id = o.id
         JOIN identity.users u ON u.id = o.user_id
        WHERE t.id = $1
        LIMIT 1`,
      [ticketId],
    );
    if (orderRes.rows.length > 0) {
      chain.push({
        event_type: 'purchased',
        actor: orderRes.rows[0].buyer_email,
        details: 'Původní zakoupení',
        timestamp: orderRes.rows[0].created_at,
      });
    }

    // 2. Transfers
    try {
      const transferRes = await rlsDb().query<{
        from_email: string;
        to_email: string;
        created_at: string;
      }>(
        `SELECT
           (SELECT email FROM identity.users WHERE id = tl.from_user_id) AS from_email,
           (SELECT email FROM identity.users WHERE id = tl.to_user_id) AS to_email,
           tl.created_at::text
         FROM tickets.ticket_transfer_log tl
         WHERE tl.ticket_id = $1
         ORDER BY tl.created_at ASC`,
        [ticketId],
      );
      for (const row of transferRes.rows) {
        chain.push({
          event_type: 'transferred',
          actor: row.from_email,
          details: `Přeposlán na ${row.to_email}`,
          timestamp: row.created_at,
        });
      }
    } catch {
      // Table neexistuje — ignore
    }

    // 3. Resale (if listed)
    try {
      const resaleRes = await rlsDb().query<{ status: string; listed_at: string }>(
        `SELECT status, listed_at::text
           FROM resale.resale_listings
          WHERE ticket_id = $1
          ORDER BY listed_at ASC`,
        [ticketId],
      );
      for (const row of resaleRes.rows) {
        chain.push({
          event_type: 'resale_listed',
          actor: ticket.current_holder_email,
          details: `Nabídnut na resale (${row.status})`,
          timestamp: row.listed_at,
        });
      }
    } catch {
      // ignore
    }

    // 4. Scan event
    if (ticket.used_at) {
      chain.push({
        event_type: 'scanned',
        actor: 'Scanner',
        details: 'Naskenován při vstupu',
        timestamp: ticket.used_at,
      });
    }

    // Sort chronologically
    chain.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return { ticket, chain };
  } finally {
    // RLS pool je sdílený (rls-pool), neukončuje se per-request
  }
}

export const dynamic = 'force-dynamic';

const ICON_MAP: Record<string, typeof User> = {
  purchased: ShoppingBag,
  transferred: Send,
  resale_listed: RefreshCw,
  scanned: ScanLine,
};

const LABEL_MAP: Record<string, string> = {
  purchased: 'Zakoupení',
  transferred: 'Transfer',
  resale_listed: 'Resale',
  scanned: 'Vstup',
};

export default async function TicketChainPage(
  props: {
    params: Promise<{ id: string; ticketId: string }>;
  }
) {
  const params = await props.params;
  // Promoter kontext z accessToken cookie (server-side). RLS + explicitní
  // e.promoter_id = $2 filtr → lístek se zobrazí jen vlastníkovi akce.
  const data = await runAsServerPromoter(({ promoterId }) =>
    fetchTicketChain(params.ticketId, promoterId),
  );

  if (!data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-xl font-bold">Lístek nenalezen</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Lístek neexistuje nebo nepatří k tvé akci.
        </p>
      </div>
    );
  }

  const { ticket, chain } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/events/${params.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Zpět na akci
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Historie lístku</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ticket.event_title}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Ticket ID</p>
            <p className="mt-1 font-mono text-xs">{ticket.ticket_id.slice(0, 13)}...</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Aktuální držitel</p>
            <p className="mt-1 font-medium">{ticket.current_holder_name ?? '—'}</p>
            <p className="text-xs text-muted-foreground">{ticket.current_holder_email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Stav</p>
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
              ticket.status === 'valid' ? 'bg-emerald-100 text-emerald-900' : 'bg-zinc-100 text-zinc-700'
            }`}>
              {ticket.status}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Naskenován</p>
            <p className="mt-1 text-sm">{ticket.used_at ? new Date(ticket.used_at).toLocaleString('cs-CZ') : '—'}</p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Chain of Custody</h2>
        {chain.length === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné události v historii.</p>
        ) : (
          <ol className="space-y-3">
            {chain.map((ev, i) => {
              const Icon = ICON_MAP[ev.event_type] ?? User;
              return (
                <li key={i} className="flex gap-4 rounded-lg border bg-card p-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" aria-hidden />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{LABEL_MAP[ev.event_type] ?? ev.event_type}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(ev.timestamp).toLocaleString('cs-CZ')}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <span className="font-mono">{ev.actor}</span>
                      <ArrowRight className="mx-2 inline h-3 w-3" aria-hidden />
                      {ev.details}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
