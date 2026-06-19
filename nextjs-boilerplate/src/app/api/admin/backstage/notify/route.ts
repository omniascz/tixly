import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const schema = z.object({
  eventId: z.string().uuid(),
});

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  promoter_id: string;
}

interface BackstageMomentRow {
  video_url: string;
  is_active: boolean;
  notify_minutes_before: number;
}

interface BuyerEmailRow {
  email: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }

    const { eventId } = parsed.data;

    const eventRes = await db().query<EventRow>(
      `SELECT id, title, date_start, promoter_id
         FROM catalog.events
        WHERE id = $1 AND promoter_id = $2`,
      [eventId, promoter.promoterId],
    );
    if (eventRes.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const event = eventRes.rows[0];

    const momentRes = await db().query<BackstageMomentRow>(
      `SELECT video_url, is_active, notify_minutes_before
         FROM catalog.backstage_moments
        WHERE event_id = $1`,
      [eventId],
    );
    if (momentRes.rows.length === 0 || !momentRes.rows[0].is_active) {
      return NextResponse.json(
        { error: 'NO_ACTIVE_MOMENT', message: 'Backstage moment neexistuje nebo není aktivní.' },
        { status: 422 },
      );
    }
    const moment = momentRes.rows[0];

    const now = Date.now();
    const eventStart = new Date(event.date_start).getTime();
    const diffMs = eventStart - now;
    const diffMinutes = diffMs / 60_000;

    if (diffMinutes <= 0) {
      return NextResponse.json(
        { error: 'EVENT_STARTED', message: 'Akce již začala nebo skončila.' },
        { status: 422 },
      );
    }
    if (diffMinutes > moment.notify_minutes_before + 5) {
      return NextResponse.json(
        {
          error: 'TOO_EARLY',
          message: `Akce začíná za ${Math.round(diffMinutes)} minut. Notifikace se odesílá nejdříve ${moment.notify_minutes_before + 5} minut před začátkem.`,
        },
        { status: 422 },
      );
    }

    const buyersRes = await db().query<BuyerEmailRow>(
      `SELECT DISTINCT u.email
         FROM orders.orders o
         JOIN identity.users u ON u.id = o.user_id
        WHERE o.event_id = $1
          AND o.status IN ('paid', 'paid_partial')
          AND u.anonymized_at IS NULL`,
      [eventId],
    );
    const emails = buyersRes.rows.map((r) => r.email);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const backstageUrl = `${appUrl}/cs/backstage/${eventId}`;

    console.log(
      `Backstage notification: odesílám na ${emails.length} emailů pro event [${event.title}]`,
    );

    return NextResponse.json({ notified: emails.length, backstageUrl });
  });
}
