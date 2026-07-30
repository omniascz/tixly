import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    eventId?: string;
    journalistName?: string;
    journalistEmail?: string;
    mediaOutlet?: string;
    purpose?: string;
  };

  if (
    !body.eventId ||
    typeof body.eventId !== 'string' ||
    !body.journalistName?.trim() ||
    !body.journalistEmail?.trim() ||
    !body.mediaOutlet?.trim()
  ) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  if (!/^[0-9a-f-]{36}$/i.test(body.eventId)) {
    return NextResponse.json({ error: 'INVALID_EVENT_ID' }, { status: 422 });
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(body.journalistEmail)) {
    return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 422 });
  }

  const eventRes = await db().query<{
    id: string;
    name: string;
    status: string;
    press_seats_max: number;
    press_deadline: string | null;
  }>(
    `SELECT id, name, status, press_seats_max, press_deadline
     FROM catalog.events
     WHERE id = $1`,
    [body.eventId],
  );

  if (eventRes.rows.length === 0) {
    return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
  }

  const event = eventRes.rows[0];

  if (event.status !== 'published') {
    return NextResponse.json({ error: 'ACCREDITATION_CLOSED' }, { status: 422 });
  }

  if (event.press_deadline && new Date(event.press_deadline) < new Date()) {
    return NextResponse.json({ error: 'DEADLINE_PASSED' }, { status: 422 });
  }

  if (event.press_seats_max > 0) {
    const countRes = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM orders.press_accreditations
       WHERE event_id = $1 AND status = 'approved'`,
      [body.eventId],
    );
    const approved = Number(countRes.rows[0]?.count ?? 0);
    if (approved >= event.press_seats_max) {
      return NextResponse.json({ error: 'ACCREDITATION_FULL' }, { status: 422 });
    }
  }

  const dupRes = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM orders.press_accreditations
     WHERE event_id = $1 AND journalist_email = LOWER($2) AND status <> 'rejected'`,
    [body.eventId, body.journalistEmail],
  );
  if (Number(dupRes.rows[0]?.count ?? 0) > 0) {
    return NextResponse.json({ error: 'ALREADY_APPLIED' }, { status: 409 });
  }

  await db().query(
    // `promoter_id` je na orders.press_accreditations NOT NULL bez defaultu a
    // INSERT ho neuváděl → 23502 při KAŽDÉ žádosti o akreditaci (doloženo
    // reálným během proti klonu prod schématu). Bere se z akce subquery —
    // stejný vzor jako currency redirect (box-office/route.ts:33), protože
    // catalog.events.promoter_id je NOT NULL FK, takže vazba je 1:1 a subquery
    // nemůže vrátit NULL ani víc řádků.
    `INSERT INTO orders.press_accreditations
       (event_id, promoter_id, journalist_name, journalist_email, media_outlet, purpose)
     VALUES ($1, (SELECT promoter_id FROM catalog.events WHERE id = $1),
             $2, LOWER($3), $4, $5)`,
    [
      body.eventId,
      body.journalistName.trim(),
      body.journalistEmail.trim(),
      body.mediaOutlet.trim(),
      body.purpose?.trim() ?? null,
    ],
  );

  console.log(`Nová žádost o akreditaci: ${body.journalistName.trim()} z ${body.mediaOutlet.trim()}`);

  return NextResponse.json({
    ok: true,
    message: 'Vaše žádost byla přijata. Vyrozumíme vás do 48 hodin.',
  });
}
