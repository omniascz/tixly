/**
 * POST /api/buyer/cross-passes/purchase
 * Body: { bundleId, buyerEmail?, buyerName? }
 *
 * Demo: instant purchase, mock GoPay vyřazen.
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { encryptSecret } from '@/lib/crypto';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  bundleId: z.string().uuid(),
  buyerEmail: z.string().email().optional(),
  buyerName: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const headerUserId = req.headers.get('x-user-id');

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Resolve user
    let userId: string;
    if (headerUserId) {
      userId = headerUserId;
    } else if (parsed.data.buyerEmail) {
      const u = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES ($1, $2, '!guest', NOW(), NOW(), NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [parsed.data.buyerEmail.toLowerCase(), parsed.data.buyerName ?? parsed.data.buyerEmail],
      );
      userId = u.rows[0].id;
    } else {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Auth required' }, { status: 401 });
    }

    // Validate bundle
    const b = await client.query<{
      id: string;
      active: boolean;
      remaining_qty: number | null;
      price_halire: number;
    }>(
      `SELECT id, active, remaining_qty, price_halire
       FROM catalog.cross_pass_bundles
       WHERE id = $1 FOR UPDATE`,
      [parsed.data.bundleId],
    );
    if (b.rows.length === 0 || !b.rows[0].active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'BUNDLE_NOT_AVAILABLE' }, { status: 422 });
    }
    const bundle = b.rows[0];
    if (bundle.remaining_qty !== null && bundle.remaining_qty < 1) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'SOLD_OUT' }, { status: 409 });
    }

    // TOTP secret pro membership
    const totpSecretRaw = randomBytes(20);
    const encryptedBundle = Buffer.from(
      encryptSecret(totpSecretRaw.toString('base64')),
      'base64',
    );

    const m = await client.query<{ id: string }>(
      `INSERT INTO tickets.cross_pass_memberships
         (bundle_id, user_id, status, totp_secret_encrypted, totp_secret_iv)
       VALUES ($1, $2, 'active', $3, $4)
       ON CONFLICT (bundle_id, user_id) DO UPDATE SET status = 'active'
       RETURNING id`,
      [bundle.id, userId, encryptedBundle, Buffer.alloc(0)],
    );

    if (bundle.remaining_qty !== null) {
      await client.query(
        `UPDATE catalog.cross_pass_bundles SET remaining_qty = remaining_qty - 1 WHERE id = $1`,
        [bundle.id],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json(
      { ok: true, membershipId: m.rows[0].id, pricePaidHalire: bundle.price_halire },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[cross-pass purchase]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
