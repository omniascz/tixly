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
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { assertPublicHttpUrl, SsrfError } from '@/lib/security/ssrf';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES } from '@/lib/webhooks/event-types';


const CreateSchema = z.object({
  url: z.string().url().max(500),
  description: z.string().max(200).optional(),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, 'At least one event type required'),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
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

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // SSRF guard už při ukládání — interní/privátní URL se nesmí ani zaregistrovat.
  try {
    await assertPublicHttpUrl(parsed.data.url);
  } catch (err) {
    if (err instanceof SsrfError) {
      return NextResponse.json(
        { error: 'URL musí ukazovat na veřejný http(s) endpoint (ne localhost/interní IP).' },
        { status: 422 },
      );
    }
    throw err;
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

  });
}
