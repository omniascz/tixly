/**
 * GET   /api/buyer/me — vrátí profil + notification prefs
 * PATCH /api/buyer/me — update jméno, telefon
 *
 * Auth: x-user-id (middleware z JWT).
 *
 * Email change není povolen (vyžadovala by re-verifikaci) — buyer kontaktuje support.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().min(6).max(30).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRes = await db().query<{
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    created_at: string;
    email_verified_at: string | null;
    phone_verified_at: string | null;
  }>(
    `SELECT id, email, name, phone, created_at, email_verified_at, phone_verified_at
     FROM identity.users
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (userRes.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const u = userRes.rows[0];

  const prefRes = await db().query<{
    email_enabled: boolean;
    sms_enabled: boolean;
    push_enabled: boolean;
    order_confirmations: boolean;
    pre_event_reminders: boolean;
    marketing: boolean;
    promoter_news: boolean;
    abandoned_cart: boolean;
  }>(
    `SELECT email_enabled, sms_enabled, push_enabled,
            order_confirmations, pre_event_reminders, marketing,
            promoter_news, abandoned_cart
     FROM identity.notification_preferences
     WHERE user_id = $1`,
    [userId],
  );
  const prefs = prefRes.rows[0] ?? {
    email_enabled: true,
    sms_enabled: false,
    push_enabled: false,
    order_confirmations: true,
    pre_event_reminders: true,
    marketing: false,
    promoter_news: false,
    abandoned_cart: true,
  };

  // Pending GDPR deletion?
  const delRes = await db().query<{
    id: string;
    status: string;
    scheduled_at: string | null;
  }>(
    `SELECT id, status, scheduled_at
     FROM identity.gdpr_requests
     WHERE user_id = $1 AND status IN ('pending', 'scheduled')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );

  return NextResponse.json({
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    createdAt: u.created_at,
    emailVerified: u.email_verified_at !== null,
    phoneVerified: u.phone_verified_at !== null,
    preferences: {
      emailEnabled: prefs.email_enabled,
      smsEnabled: prefs.sms_enabled,
      pushEnabled: prefs.push_enabled,
      orderConfirmations: prefs.order_confirmations,
      preEventReminders: prefs.pre_event_reminders,
      marketing: prefs.marketing,
      promoterNews: prefs.promoter_news,
      abandonedCart: prefs.abandoned_cart,
    },
    pendingDeletion: delRes.rows[0]
      ? {
          id: delRes.rows[0].id,
          status: delRes.rows[0].status,
          scheduledAt: delRes.rows[0].scheduled_at,
        }
      : null,
  });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const updates: string[] = [];
  const args: unknown[] = [userId];
  if (parsed.data.name !== undefined) {
    args.push(parsed.data.name);
    updates.push(`name = $${args.length}`);
  }
  if (parsed.data.phone !== undefined) {
    args.push(parsed.data.phone);
    updates.push(`phone = $${args.length}, phone_verified_at = NULL`);
  }
  if (updates.length === 0) {
    return NextResponse.json({ success: true, unchanged: true });
  }
  await db().query(
    `UPDATE identity.users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`,
    args,
  );
  return NextResponse.json({ success: true });
}
