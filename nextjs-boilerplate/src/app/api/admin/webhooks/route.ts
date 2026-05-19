/**
 * GET /api/admin/webhooks — list endpoints promotéra
 * POST /api/admin/webhooks — vytvořit endpoint
 *
 * Body POST:
 *   { url: string, description?, events: string[] }
 *
 * Secret je auto-generovaný (32 hex chars) a vrácený jen jednou
 * v POST response. Promotér si ho uloží — neuvidí ho znovu.
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { WEBHOOK_EVENT_TYPES } from '@/lib/webhooks/event-types';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const CreateSchema = z.object({
  url: z.string().url().max(500),
  description: z.string().max(200).optional(),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, 'At least one event type required'),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query(
    `SELECT id, url, description, events, is_active,
            timeout_ms, max_retries, created_at, last_triggered_at,
            (SELECT COUNT(*)::int FROM reservations.webhook_deliveries d
              WHERE d.endpoint_id = e.id AND d.status = 'failed') AS failed_count,
            (SELECT COUNT(*)::int FROM reservations.webhook_deliveries d
              WHERE d.endpoint_id = e.id AND d.status = 'success') AS success_count
     FROM reservations.webhook_endpoints e
     WHERE promoter_id = $1
     ORDER BY created_at DESC`,
    [promoter.promoterId],
  );
  return NextResponse.json({ items: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const secret = randomBytes(16).toString('hex');

  try {
    const r = await db().query<{ id: string }>(
      `INSERT INTO reservations.webhook_endpoints
         (promoter_id, url, description, secret, events, is_active)
       VALUES ($1, $2, $3, $4, $5::text[], TRUE)
       RETURNING id`,
      [
        promoter.promoterId,
        parsed.data.url,
        parsed.data.description ?? null,
        secret,
        parsed.data.events,
      ],
    );
    return NextResponse.json(
      { id: r.rows[0].id, secret },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) {
      return NextResponse.json(
        { error: 'URL už registrované pro tento profil' },
        { status: 409 },
      );
    }
    throw err;
  }
}
