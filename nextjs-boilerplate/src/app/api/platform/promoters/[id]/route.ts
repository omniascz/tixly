/**
 * GET   /api/platform/promoters/[id] — full detail for master admin review
 * PATCH /api/platform/promoters/[id] — update country, currency, tier, fee, holdback overrides
 *
 * GET: základní info + KYC stav + ARES data + members + recent events + KYC dokumenty.
 * PATCH: master admin upraví CZ/SK launch fields (migrace 265).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const detailRes = await db().query<{
    id: string; name: string; slug: string | null;
    email: string; contact_email: string | null;
    status: string; locale: string;
    company_ico: string | null; company_dic: string | null; company_address: string | null;
    bank_account: string | null;
    vat_payer: boolean; vat_rate_pct: number;
    brand_logo_url: string | null; brand_color_hex: string | null; brand_tagline: string | null;
    kyc_status: string;
    kyc_submitted_at: string | null; kyc_reviewed_at: string | null;
    kyc_rejection_reason: string | null;
    ares_verified_at: string | null; ares_data: unknown;
    country: string;
    primary_currency: string;
    tier: number;
    tier_locked: boolean;
    chargeback_holdback_pct: number | null;
    chargeback_holdback_days: number | null;
    created_at: string; updated_at: string;
  }>(
    `SELECT id, name, slug, email, contact_email, status, locale,
            company_ico, company_dic, company_address, bank_account,
            vat_payer, vat_rate_pct,
            brand_logo_url, brand_color_hex, brand_tagline,
            kyc_status, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason,
            ares_verified_at, ares_data,
            country, primary_currency,
            tier, tier_locked,
            chargeback_holdback_pct, chargeback_holdback_days,
            created_at, updated_at
       FROM platform.promoters
      WHERE id = $1`,
    [params.id],
  );
  if (!detailRes.rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const detail = detailRes.rows[0];

  const [members, events, documents] = await Promise.all([
    db().query<{ user_id: string; email: string; name: string | null; role: string; created_at: string }>(
      `SELECT pm.user_id, u.email, u.name, pm.role::text AS role, pm.created_at
         FROM platform.promoter_members pm
         JOIN identity.users u ON u.id = pm.user_id
        WHERE pm.promoter_id = $1
        ORDER BY pm.created_at`,
      [params.id],
    ),
    db().query<{ id: string; title: string; status: string; date_start: string; created_at: string }>(
      `SELECT id, title, status, date_start, created_at
         FROM catalog.events
        WHERE promoter_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [params.id],
    ),
    db().query<{ id: string; doc_type: string; file_url: string; uploaded_at: string }>(
      `SELECT id, doc_type, file_url, uploaded_at
         FROM platform.promoter_documents
        WHERE promoter_id = $1
        ORDER BY uploaded_at DESC`,
      [params.id],
    ).catch(() => ({ rows: [] as { id: string; doc_type: string; file_url: string; uploaded_at: string }[] })),
  ]);

  // Active fee schedule (lookup pro buyer_fee + percentage_fee)
  const feeRes = await db()
    .query<{
      percentage_fee: number;
      buyer_fee_halire: number;
      currency: string;
      override_reason: string | null;
    }>(
      `SELECT percentage_fee, buyer_fee_halire, currency, override_reason
         FROM platform.fee_schedules
        WHERE promoter_id = $1
          AND is_active = TRUE
          AND valid_from <= NOW()
          AND (valid_until IS NULL OR valid_until > NOW())
        ORDER BY valid_from DESC`,
      [params.id],
    )
    .catch(() => ({ rows: [] as Array<{ percentage_fee: number; buyer_fee_halire: number; currency: string; override_reason: string | null }> }));

  return NextResponse.json({
    promoter: detail,
    members: members.rows,
    recentEvents: events.rows,
    documents: documents.rows,
    feeSchedules: feeRes.rows,
  });
}

const patchSchema = z.object({
  country: z.enum(['CZ', 'SR']).optional(),
  primaryCurrency: z.enum(['CZK', 'EUR']).optional(),
  tier: z.number().int().min(1).max(4).optional(),
  tierLocked: z.boolean().optional(),
  chargebackHoldbackPct: z.number().int().min(0).max(2000).nullable().optional(),
  chargebackHoldbackDays: z.number().int().min(0).max(365).nullable().optional(),
  vatRatePct: z.number().int().min(0).max(50).optional(),
  vatPayer: z.boolean().optional(),
  // Fee override (vytvoří nový aktivní fee_schedule)
  feePctBps: z.number().int().min(0).max(10000).optional(),
  buyerFeeHalire: z.number().int().min(0).max(100_000).optional(),
  feeCurrency: z.enum(['CZK', 'EUR']).optional(),
  feeOverrideReason: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // 1) Update promoter base fields (country, currency, tier, holdback overrides, vat)
    const updates: string[] = [];
    const values: unknown[] = [params.id];
    let i = 2;
    if (input.country !== undefined) {
      updates.push(`country = $${i++}`);
      values.push(input.country);
    }
    if (input.primaryCurrency !== undefined) {
      updates.push(`primary_currency = $${i++}`);
      values.push(input.primaryCurrency);
    }
    if (input.tier !== undefined) {
      updates.push(`tier = $${i++}, tier_updated_at = NOW()`);
      values.push(input.tier);
    }
    if (input.tierLocked !== undefined) {
      updates.push(`tier_locked = $${i++}`);
      values.push(input.tierLocked);
    }
    if (input.chargebackHoldbackPct !== undefined) {
      updates.push(`chargeback_holdback_pct = $${i++}`);
      values.push(input.chargebackHoldbackPct);
    }
    if (input.chargebackHoldbackDays !== undefined) {
      updates.push(`chargeback_holdback_days = $${i++}`);
      values.push(input.chargebackHoldbackDays);
    }
    if (input.vatRatePct !== undefined) {
      updates.push(`vat_rate_pct = $${i++}`);
      values.push(input.vatRatePct);
    }
    if (input.vatPayer !== undefined) {
      updates.push(`vat_payer = $${i++}`);
      values.push(input.vatPayer);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      await client.query(
        `UPDATE platform.promoters SET ${updates.join(', ')} WHERE id = $1`,
        values,
      );
    }

    // 2) Pokud došlo k fee override → vytvořit nový aktivní fee_schedule
    //    (zachová historii — staré schedule zůstávají, jen je deaktivujeme)
    if (input.feePctBps !== undefined || input.buyerFeeHalire !== undefined) {
      if (input.feePctBps === undefined || input.buyerFeeHalire === undefined) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'INCOMPLETE_FEE_OVERRIDE', message: 'feePctBps a buyerFeeHalire musí být oba.' },
          { status: 422 },
        );
      }
      const currency = input.feeCurrency ?? 'CZK';
      // Deactivate předchozí pro stejnou měnu
      await client.query(
        `UPDATE platform.fee_schedules
            SET is_active = FALSE, valid_until = COALESCE(valid_until, NOW())
          WHERE promoter_id = $1 AND currency = $2 AND is_active = TRUE`,
        [params.id, currency],
      );
      await client.query(
        `INSERT INTO platform.fee_schedules
           (promoter_id, name, percentage_fee, fixed_fee, buyer_fee_halire,
            currency, override_reason, valid_from, is_active)
         VALUES ($1, $2, $3, 0, $4, $5, $6, NOW(), TRUE)`,
        [
          params.id,
          `Custom override ${new Date().toISOString().slice(0, 10)}`,
          input.feePctBps,
          input.buyerFeeHalire,
          currency,
          input.feeOverrideReason ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('platform', 'promoters', $1, 'UPDATE', $2, 'platform_admin', $3::jsonb)`,
      [params.id, admin.userId, JSON.stringify(input)],
    );

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, id: params.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/platform/promoters/[id]]', err);
    return NextResponse.json({ error: 'INTERNAL', message: String(err) }, { status: 500 });
  } finally {
    client.release();
  }
}
