/**
 * GET/POST /api/v3/webhooks
 *
 * Eventbrite-style webhook subscription management for OAuth client.
 * Scope: manage_webhooks
 *
 * Body POST: { url, event_types: [...], signing_secret? }
 * Vrací: { webhook_id, signing_secret (vygenerovaný pokud chybí) }
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import crypto from 'node:crypto';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';
import { hashSecret } from '@/lib/oauth/flow';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const ALLOWED_EVENT_TYPES = [
  'order.created', 'order.paid', 'order.cancelled', 'order.refunded',
  'event.published', 'event.updated', 'event.cancelled',
  'ticket.issued', 'ticket.transferred', 'ticket.revoked',
  'attendee.checked_in',
];

const postSchema = z.object({
  url: z.string().url(),
  event_types: z.array(z.enum(ALLOWED_EVENT_TYPES as [string, ...string[]])).min(1).max(20),
});

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireApiAuth(req, 'manage_webhooks');
  if (!auth.ok) return auth.response;

  const rl = await rateLimitCheck(auth.ctx, '/api/v3/webhooks', 'GET');
  if (!rl.ok) return rl.response;

  const idCol = auth.ctx.type === 'oauth' ? 'client_id' : 'api_key_id';
  const idVal = auth.ctx.type === 'oauth' ? auth.ctx.clientPkId : auth.ctx.apiKeyId;

  const r = await db().query(
    `SELECT id, url, event_types, status,
            last_delivery_at::text, last_delivery_status, consecutive_failures,
            created_at::text
       FROM b2b.webhook_subscriptions
      WHERE ${idCol} = $1
   ORDER BY created_at DESC`,
    [idVal],
  );

  return NextResponse.json({ webhooks: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireApiAuth(req, 'manage_webhooks');
  if (!auth.ok) return auth.response;

  const rl = await rateLimitCheck(auth.ctx, '/api/v3/webhooks', 'POST');
  if (!rl.ok) return rl.response;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  const signingSecret = `whsec_${crypto.randomBytes(32).toString('hex')}`;
  const secretHash = hashSecret(signingSecret);

  const r = await db().query<{ id: string }>(
    `INSERT INTO b2b.webhook_subscriptions
       (client_id, api_key_id, url, event_types, signing_secret_hash)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      auth.ctx.type === 'oauth' ? auth.ctx.clientPkId : null,
      auth.ctx.type === 'api_key' ? auth.ctx.apiKeyId : null,
      parsed.data.url, parsed.data.event_types, secretHash,
    ],
  );

  return NextResponse.json({
    id: r.rows[0].id,
    url: parsed.data.url,
    event_types: parsed.data.event_types,
    signing_secret: signingSecret,
    warning: 'Signing secret se zobrazuje JEN teď. Ulož ho — později ho nelze získat zpět.',
  }, { status: 201 });
}
