import { randomBytes } from 'crypto';
/**
 * POST /api/events/[id]/alert — "Upozorni mě" přihlášení
 * DELETE /api/events/[id]/alert?token=xxx — odhlášení (unsubscribe)
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext, runWithUserContext } from '@/lib/db/rls-pool';

async function POSTImpl(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  let body: { email?: string; alertType?: string };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const alertType = body.alertType ?? 'on_sale';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'INVALID_EMAIL' }, { status: 422 });
  }
  if (!['on_sale', 'restock', 'price_drop'].includes(alertType)) {
    return NextResponse.json({ error: 'INVALID_ALERT_TYPE' }, { status: 422 });
  }

  const userId = req.headers.get('x-user-id');

  const client = await db().connect();
  try {
    // Check event exists + is published
    const ev = await client.query(
      `SELECT id, title FROM catalog.events WHERE id = $1`,
      [params.id],
    );
    if (ev.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    // Token generuje aplikace, ne DB. Sloupcový DEFAULT byl
    // `encode(…, 'base64url')`, což nefunguje na zadne vydane verzi Postgresu
    // (pribylo az v PG 19, ta nevysla) — kazdy INSERT koncil na 22023.
    // Migrace 456 DEFAULT rusi, delku 16 B zachovavame.
    const alertToken = randomBytes(16).toString('base64url');
    const r = await client.query<{ token: string }>(
      `INSERT INTO marketing.ticket_alerts (email, event_id, user_id, alert_type, token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email, event_id, alert_type) DO UPDATE SET cancelled_at = NULL
       RETURNING token`,
      [email, params.id, userId ?? null, alertType, alertToken],
    );

    return NextResponse.json({ token: r.rows[0].token, eventTitle: ev.rows[0].title });
  } catch (err) {
    console.error('[POST /api/events/:id/alert]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

async function DELETEImpl(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'MISSING_TOKEN' }, { status: 400 });

  const client = await db().connect();
  try {
    await client.query(
      `UPDATE marketing.ticket_alerts
          SET cancelled_at = now()
        WHERE token = $1 AND event_id = $2`,
      [token, params.id],
    );
    return NextResponse.json({ unsubscribed: true });
  } finally {
    client.release();
  }
}

// ── Kontext (FINDINGS 102 / R-14) ────────────────────────────────────────────
// Routa drive bezela na holem db().connect(): x-user-id se cetlo do promenne
// a predalo jako SLOUPEC, ale do session GUC se nedostalo. Pod tixly_app proto
// padal INSERT ... RETURNING token na 42501 — zapis prosel (ticket_alerts_insert
// ma WITH CHECK (true)), ale SELECT policy nedovolila precist prave vlozeny
// radek. Zmereno: bez RETURNING OK, s RETURNING 42501.
//
// Anonym jde SERVISNIM kontextem, ne policy vetvi na prazdny kontext. Vetev
// `app_current_user_id() IS NULL` byla zmerena a otevira cele upozorneni vsem:
// anonym pod ni videl 3 ze 3 radku vcetne 3 cizich e-mailu. Servisni kontext
// drzi rozhodnuti v routе, kde je videt.
type AlertCtx = { params: { id: string } };

export async function POST(req: NextRequest, ctx: AlertCtx): Promise<Response> {
  const uid = req.headers.get('x-user-id');
  return uid
    ? runWithUserContext(uid, () => POSTImpl(req, ctx))
    : runWithServiceContext(() => POSTImpl(req, ctx));
}

// Odhlaseni chodi z e-mailu, prijemce neni prihlaseny — servisni kontext.
// Routa se filtruje sama tokenem (WHERE token = $1 AND event_id = $2).
export async function DELETE(req: NextRequest, ctx: AlertCtx): Promise<Response> {
  return runWithServiceContext(() => DELETEImpl(req, ctx));
}
