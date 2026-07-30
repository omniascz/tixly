import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const createSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(20).max(10_000),
  target: z.enum(['all', 'buyers_only', 'contacts_only', 'subscribers', 'event']),
  eventId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query<{
      id: string;
      subject: string;
      target: string;
      event_id: string | null;
      event_title: string | null;
      status: string;
      recipient_count: number;
      sent_at: string | null;
      created_at: string;
    }>(
      `SELECT b.id, b.subject, b.target, b.event_id, e.title AS event_title,
              b.status, b.recipient_count, b.sent_at, b.created_at
       FROM communications.broadcasts b
       LEFT JOIN catalog.events e ON e.id = b.event_id
       WHERE b.promoter_id = $1
       ORDER BY b.created_at DESC
       LIMIT 100`,
      [promoter.promoterId],
    );

    return NextResponse.json({
      broadcasts: r.rows.map((row) => ({
        id: row.id,
        subject: row.subject,
        target: row.target,
        eventId: row.event_id,
        eventTitle: row.event_title,
        status: row.status,
        recipientCount: row.recipient_count,
        sentAt: row.sent_at,
        createdAt: row.created_at,
      })),
    });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    if (input.target === 'event' && !input.eventId) {
      return NextResponse.json({ error: 'eventId required for target=event' }, { status: 422 });
    }

    if (input.eventId) {
      const evRes = await db().query<{ id: string }>(
        `SELECT id FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
        [input.eventId, promoter.promoterId],
      );
      if (!evRes.rows[0]) {
        return NextResponse.json({ error: 'EVENT_FORBIDDEN' }, { status: 403 });
      }
    }

    const r = await db().query<{ id: string }>(
      // `communications.broadcasts` NEMÁ sloupec `sent_by_user_id` — tabulka
      // vůbec nemá uživatelský sloupec, jen `promoter_id`. PŘED: 42703 → 500
      // při každém založení rozesílky. Ověřeno reálným během proti klonu.
      //
      // ⚠️ ZBÝVÁ PODMÍNĚNÝ BLOCKER (tímhle commitem NEOPRAVENÝ): zod na :9
      // povoluje `target: 'event'`, ale `broadcasts_target_check` zná jen
      // all/buyers_only/contacts_only/subscribers → `target='event'` dá 23514.
      // Změřeno. Oprava chce migraci (rozšířit CHECK) nebo produktové
      // rozhodnutí mapovat 'event' na jinou hodnotu — obojí mimo tenhle commit.
      `INSERT INTO communications.broadcasts
         (promoter_id, subject, body, target, event_id, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING id`,
      [
        promoter.promoterId,
        input.subject,
        input.body,
        input.target,
        input.eventId ?? null,
      ],
    );

    return NextResponse.json({ id: r.rows[0].id, status: 'draft' }, { status: 201 });
  });
}
