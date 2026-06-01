/**
 * Super Admin endpoint pro správu partner POS network.
 *
 * GET  /api/platform/partners       — list všech partnerů
 * POST /api/platform/partners       — vytvoří partnera + první token (raw token vrácen 1×)
 *
 * Vyžaduje platform admin auth (zatím jen INTERNAL_SERVICE_TOKEN protection,
 * v produkci se napojí na users.is_platform_admin).
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';
import { generatePartnerToken } from '@/lib/partner/auth';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function isPlatformAdmin(req: NextRequest): boolean {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  return Boolean(expected) && safeEqual(token, expected);
}

const createSchema = z.object({
  name: z.string().min(2).max(120),
  legalName: z.string().max(200).optional(),
  ico: z.string().regex(/^\d{8}$/).optional(),
  dic: z.string().max(20).optional(),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  bankAccount: z.string().max(50).optional(),
  commissionPct: z.number().min(0).max(50).default(5),
  tokenLabel: z.string().min(1).max(120).default('Primary'),
});

export async function GET(req: NextRequest): Promise<Response> {
  if (!isPlatformAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runWithPlatformAdminContext(async () => {
    const r = await db().query(
      `SELECT p.id, p.name, p.legal_name, p.ico, p.dic, p.contact_email,
              p.commission_pct, p.status, p.created_at,
              (SELECT COUNT(*) FROM partner.partner_tokens t WHERE t.partner_id = p.id AND t.revoked_at IS NULL) AS active_tokens,
              (SELECT COUNT(*) FROM partner.partner_sales s WHERE s.partner_id = p.id) AS total_sales
       FROM partner.partners p
       ORDER BY p.created_at DESC`,
    );
    return NextResponse.json({ partners: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isPlatformAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  return runWithPlatformAdminContext(async () => {
  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const pr = await client.query<{ id: string }>(
      `INSERT INTO partner.partners
         (name, legal_name, ico, dic, contact_email, contact_phone, address,
          bank_account, commission_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        parsed.data.name,
        parsed.data.legalName ?? null,
        parsed.data.ico ?? null,
        parsed.data.dic ?? null,
        parsed.data.contactEmail,
        parsed.data.contactPhone ?? null,
        parsed.data.address ?? null,
        parsed.data.bankAccount ?? null,
        parsed.data.commissionPct,
      ],
    );
    const partnerId = pr.rows[0].id;

    const { token, hash } = generatePartnerToken();
    await client.query(
      `INSERT INTO partner.partner_tokens (partner_id, token_hash, label)
       VALUES ($1, $2, $3)`,
      [partnerId, hash, parsed.data.tokenLabel],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      partnerId,
      // Token se vrací JEN JEDNOU. Po této response už ho DB nevydá.
      token,
      warning: 'Token uložen jen jednou. Předej partnerovi přes secure channel.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[platform partners create]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  } finally {
    client.release();
  }
  });
}
