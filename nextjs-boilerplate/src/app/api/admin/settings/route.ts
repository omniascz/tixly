/**
 * GET   /api/admin/settings — vrací 4 sekce: promoter profil, branding, billing, payout, refund policy
 * PATCH /api/admin/settings — částečný update libovolné sekce
 *
 * Auth: requirePromoter; jen role=owner může měnit billing + refund policy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface SettingsRow {
  promoter_id: string;
  promoter_name: string;
  promoter_email: string;
  contact_email: string | null;
  locale: string;
  bank_account: string | null;
  brand_logo_url: string | null;
  brand_color_hex: string | null;
  brand_tagline: string | null;
  payout_cycle: string;
  rolling_reserve_pct: number;
  reserve_release_days: number;
  min_payout_amount: number;
  refund_window_days: number;
  max_refund_pct: number;
  auto_approve_under_halire: number;
  allow_customer_self_refund: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<SettingsRow>(
    `SELECT
       p.id AS promoter_id, p.name AS promoter_name, p.email AS promoter_email,
       p.contact_email, p.locale, p.bank_account,
       p.brand_logo_url, p.brand_color_hex, p.brand_tagline,
       COALESCE(s.payout_cycle, 'weekly') AS payout_cycle,
       COALESCE(s.rolling_reserve_pct, 500) AS rolling_reserve_pct,
       COALESCE(s.reserve_release_days, 90) AS reserve_release_days,
       COALESCE(s.min_payout_amount, 50000) AS min_payout_amount,
       COALESCE(rp.refund_window_days, 14) AS refund_window_days,
       COALESCE(rp.max_refund_pct, 100) AS max_refund_pct,
       COALESCE(rp.auto_approve_under_halire, 0) AS auto_approve_under_halire,
       COALESCE(rp.allow_customer_self_refund, FALSE) AS allow_customer_self_refund
     FROM platform.promoters p
     LEFT JOIN platform.payout_settings s ON s.promoter_id = p.id
     LEFT JOIN platform.refund_policies rp ON rp.promoter_id = p.id
     WHERE p.id = $1`,
    [promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const s = r.rows[0];
  return NextResponse.json({
    role: promoter.role,
    promoter: {
      id: s.promoter_id,
      name: s.promoter_name,
      email: s.promoter_email,
      contactEmail: s.contact_email,
      locale: s.locale,
    },
    branding: {
      logoUrl: s.brand_logo_url,
      colorHex: s.brand_color_hex,
      tagline: s.brand_tagline,
    },
    billing: {
      bankAccount: s.bank_account,
    },
    payout: {
      cycle: s.payout_cycle,
      rollingReservePct: s.rolling_reserve_pct / 100,
      reserveReleaseDays: s.reserve_release_days,
      minPayoutHalire: s.min_payout_amount,
    },
    refundPolicy: {
      windowDays: s.refund_window_days,
      maxPct: s.max_refund_pct,
      autoApproveUnderHalire: s.auto_approve_under_halire,
      allowCustomerSelfRefund: s.allow_customer_self_refund,
    },
  });
}

const patchSchema = z.object({
  contactEmail: z.string().email().nullable().optional(),
  locale: z.enum(['cs', 'en', 'sk', 'de']).optional(),
  payoutCycle: z.enum(['daily', 'weekly', 'monthly', 'manual']).optional(),
  minPayoutHalire: z.number().int().min(0).max(10_000_000).optional(),

  // Branding
  brandLogoUrl: z.string().url().max(500).nullable().optional(),
  brandColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'brand color: #RRGGBB')
    .nullable()
    .optional(),
  brandTagline: z.string().max(200).nullable().optional(),

  // Billing (owner-only)
  bankAccount: z.string().max(50).nullable().optional(),

  // Refund policy (owner-only)
  refundWindowDays: z.number().int().min(0).max(365).optional(),
  maxRefundPct: z.number().int().min(0).max(100).optional(),
  autoApproveUnderHalire: z.number().int().min(0).max(10_000_000).optional(),
  allowCustomerSelfRefund: z.boolean().optional(),
});

export async function PATCH(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const ownerOnlyFields = [
    input.bankAccount,
    input.refundWindowDays,
    input.maxRefundPct,
    input.autoApproveUnderHalire,
    input.allowCustomerSelfRefund,
  ];
  const touchesOwnerOnly = ownerOnlyFields.some((v) => v !== undefined);
  if (touchesOwnerOnly && promoter.role !== 'owner') {
    return NextResponse.json(
      { error: 'OWNER_ONLY', message: 'Billing a refund policy může měnit jen owner.' },
      { status: 403 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // platform.promoters: profile + branding + billing
    const promoterSets: string[] = [];
    const promoterArgs: unknown[] = [];
    let pi = 1;
    const promoterPatches: Array<[string, unknown]> = [
      ['contact_email', input.contactEmail],
      ['locale', input.locale],
      ['brand_logo_url', input.brandLogoUrl],
      ['brand_color_hex', input.brandColorHex],
      ['brand_tagline', input.brandTagline],
      ['bank_account', input.bankAccount],
    ];
    for (const [col, val] of promoterPatches) {
      if (val !== undefined) {
        promoterSets.push(`${col} = $${pi++}`);
        promoterArgs.push(val);
      }
    }
    if (promoterSets.length > 0) {
      promoterSets.push(`updated_at = NOW()`);
      promoterArgs.push(promoter.promoterId);
      await client.query(
        `UPDATE platform.promoters SET ${promoterSets.join(', ')} WHERE id = $${pi}`,
        promoterArgs,
      );
    }

    // payout_settings upsert
    if (input.payoutCycle !== undefined || input.minPayoutHalire !== undefined) {
      await client.query(
        `INSERT INTO platform.payout_settings
           (promoter_id, payout_cycle, min_payout_amount)
         VALUES ($1, COALESCE($2, 'weekly'), COALESCE($3, 50000))
         ON CONFLICT (promoter_id) DO UPDATE SET
           payout_cycle = COALESCE($2, platform.payout_settings.payout_cycle),
           min_payout_amount = COALESCE($3, platform.payout_settings.min_payout_amount),
           updated_at = NOW()`,
        [
          promoter.promoterId,
          input.payoutCycle ?? null,
          input.minPayoutHalire ?? null,
        ],
      );
    }

    // refund_policies upsert
    const refundPatches = {
      refund_window_days: input.refundWindowDays,
      max_refund_pct: input.maxRefundPct,
      auto_approve_under_halire: input.autoApproveUnderHalire,
      allow_customer_self_refund: input.allowCustomerSelfRefund,
    };
    const touchesRefund = Object.values(refundPatches).some((v) => v !== undefined);
    if (touchesRefund) {
      await client.query(
        `INSERT INTO platform.refund_policies
           (promoter_id, refund_window_days, max_refund_pct,
            auto_approve_under_halire, allow_customer_self_refund)
         VALUES ($1, COALESCE($2, 14), COALESCE($3, 100), COALESCE($4, 0), COALESCE($5, FALSE))
         ON CONFLICT (promoter_id) DO UPDATE SET
           refund_window_days = COALESCE($2, platform.refund_policies.refund_window_days),
           max_refund_pct = COALESCE($3, platform.refund_policies.max_refund_pct),
           auto_approve_under_halire = COALESCE($4, platform.refund_policies.auto_approve_under_halire),
           allow_customer_self_refund = COALESCE($5, platform.refund_policies.allow_customer_self_refund),
           updated_at = NOW()`,
        [
          promoter.promoterId,
          input.refundWindowDays ?? null,
          input.maxRefundPct ?? null,
          input.autoApproveUnderHalire ?? null,
          input.allowCustomerSelfRefund ?? null,
        ],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/admin/settings]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
