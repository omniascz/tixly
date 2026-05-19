/**
 * GET /api/buyer/notification-preferences — get or default
 * PUT /api/buyer/notification-preferences — upsert
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  orderConfirmations: z.boolean().optional(),
  preEventReminders: z.boolean().optional(),
  marketing: z.boolean().optional(),
  promoterNews: z.boolean().optional(),
  abandonedCart: z.boolean().optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<Record<string, unknown>>(
    `SELECT * FROM identity.notification_preferences WHERE user_id = $1`,
    [userId],
  );
  if (r.rows.length === 0) {
    // Return defaults
    return NextResponse.json({
      preferences: {
        email_enabled: true,
        sms_enabled: false,
        push_enabled: true,
        order_confirmations: true,
        pre_event_reminders: true,
        marketing: false,
        promoter_news: false,
        abandoned_cart: true,
      },
      isDefault: true,
    });
  }
  return NextResponse.json({ preferences: r.rows[0], isDefault: false });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const d = parsed.data;
  await db().query(
    `INSERT INTO identity.notification_preferences (
       user_id, email_enabled, sms_enabled, push_enabled,
       order_confirmations, pre_event_reminders, marketing, promoter_news, abandoned_cart
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id) DO UPDATE SET
       email_enabled = COALESCE($2, identity.notification_preferences.email_enabled),
       sms_enabled = COALESCE($3, identity.notification_preferences.sms_enabled),
       push_enabled = COALESCE($4, identity.notification_preferences.push_enabled),
       order_confirmations = COALESCE($5, identity.notification_preferences.order_confirmations),
       pre_event_reminders = COALESCE($6, identity.notification_preferences.pre_event_reminders),
       marketing = COALESCE($7, identity.notification_preferences.marketing),
       promoter_news = COALESCE($8, identity.notification_preferences.promoter_news),
       abandoned_cart = COALESCE($9, identity.notification_preferences.abandoned_cart),
       updated_at = NOW()`,
    [
      userId,
      d.emailEnabled ?? null,
      d.smsEnabled ?? null,
      d.pushEnabled ?? null,
      d.orderConfirmations ?? null,
      d.preEventReminders ?? null,
      d.marketing ?? null,
      d.promoterNews ?? null,
      d.abandonedCart ?? null,
    ],
  );
  return NextResponse.json({ ok: true });
}
