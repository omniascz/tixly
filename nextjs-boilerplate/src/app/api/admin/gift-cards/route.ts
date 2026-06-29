/**
 * GET  /api/admin/gift-cards — seznam gift karet (platform admin)
 * POST /api/admin/gift-cards — vytvořit novou gift kartu
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';

function isPlatformAdmin(req: NextRequest): boolean {
  return req.headers.get('x-is-platform-admin') === 'true';
}

const createSchema = z.object({
  valueHalire: z.number().int().min(1),
  currency: z.string().length(3).default('CZK'),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  email: z.string().email().optional(),
  promoterId: z.string().uuid().optional(),
});

function generateGiftCardCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GK-';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isPlatformAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return runWithServiceContext(async () => {
    const url = new URL(req.url);
    const filter = url.searchParams.get('filter') ?? 'all';
    const search = url.searchParams.get('search') ?? '';

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filter === 'active') {
      whereClause += ' AND gc.is_active = true AND (gc.expires_at IS NULL OR gc.expires_at > now())';
    } else if (filter === 'expired') {
      whereClause += ' AND (gc.is_active = false OR (gc.expires_at IS NOT NULL AND gc.expires_at <= now()))';
    } else if (filter === 'used') {
      whereClause += ' AND gc.remaining_value_halire = 0';
    }

    if (search) {
      params.push(`%${search.toUpperCase()}%`);
      whereClause += ` AND (UPPER(gc.code) LIKE $${params.length} OR LOWER(gc.issued_to_email) LIKE LOWER($${params.length}))`;
    }

    const r = await db().query<{
      id: string;
      code: string;
      initial_value_halire: string;
      remaining_value_halire: string;
      currency: string;
      issued_to_email: string | null;
      expires_at: string | null;
      is_active: boolean;
      created_at: string;
      last_used_at: string | null;
    }>(
      `SELECT gc.id, gc.code, gc.initial_value_halire, gc.remaining_value_halire,
              gc.currency, gc.issued_to_email, gc.expires_at::text,
              gc.is_active, gc.created_at::text, gc.last_used_at::text
         FROM platform.gift_cards gc
         ${whereClause}
         ORDER BY gc.created_at DESC
         LIMIT 200`,
      params,
    );

    return NextResponse.json({ giftCards: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isPlatformAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return runWithServiceContext(async () => {
    const body: unknown = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const input = parsed.data;

    let code: string;
    let attempts = 0;
    while (true) {
      code = generateGiftCardCode();
      const existing = await db().query<{ id: string }>(
        `SELECT id FROM platform.gift_cards WHERE code = $1`,
        [code],
      );
      if (existing.rows.length === 0) break;
      attempts++;
      if (attempts > 10) {
        return NextResponse.json({ error: 'Could not generate unique code' }, { status: 500 });
      }
    }

    const r = await db().query<{ id: string; code: string }>(
      `INSERT INTO platform.gift_cards
         (code, initial_value_halire, remaining_value_halire, currency,
          issued_to_email, promoter_id, expires_at)
       VALUES ($1, $2, $2, $3, $4, $5, $6)
       RETURNING id, code`,
      [
        code!,
        input.valueHalire,
        input.currency,
        input.email?.toLowerCase() ?? null,
        input.promoterId ?? null,
        input.expiresAt ?? null,
      ],
    );

    return NextResponse.json({ id: r.rows[0].id, code: r.rows[0].code });
  });
}
