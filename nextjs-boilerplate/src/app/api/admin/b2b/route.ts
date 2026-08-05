import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-auth';
import { db, runWithPlatformAdminContext } from '@/lib/db/rls-pool';

const createSchema = z.object({
  companyName: z.string().min(1).max(200),
  ico: z.string().min(6).max(20),
  dic: z.string().max(20).optional(),
  contactEmail: z.string().email(),
  billingEmail: z.string().email().optional(),
  monthlyLimitHalire: z.number().int().positive().optional(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['active', 'suspended', 'closed']).optional(),
  monthlyLimitHalire: z.number().int().positive().nullable().optional(),
});

async function GETImpl(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const rows = await db().query<{
    id: string;
    company_name: string;
    ico: string;
    dic: string | null;
    contact_email: string;
    billing_email: string | null;
    account_code: string;
    credit_balance_halire: string;
    monthly_limit_halire: string | null;
    status: string;
    created_at: string;
    user_count: string;
    computed_balance: string;
  }>(
    `SELECT ba.*,
       COUNT(bau.id) AS user_count,
       (SELECT COALESCE(SUM(amount_halire) FILTER (WHERE type='deposit'), 0)
               - COALESCE(SUM(ABS(amount_halire)) FILTER (WHERE type='purchase'), 0)
        FROM platform.b2b_transactions WHERE account_id = ba.id) AS computed_balance
     FROM platform.b2b_accounts ba
     LEFT JOIN platform.b2b_account_users bau ON bau.account_id = ba.id
     GROUP BY ba.id
     ORDER BY ba.created_at DESC`,
  );

  return NextResponse.json({ accounts: rows.rows });
}

async function POSTImpl(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  const res = await db().query<{ id: string; account_code: string }>(
    `INSERT INTO platform.b2b_accounts
       (company_name, ico, dic, contact_email, billing_email, monthly_limit_halire)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, account_code, company_name, ico, contact_email, credit_balance_halire, status, created_at`,
    [d.companyName, d.ico, d.dic ?? null, d.contactEmail, d.billingEmail ?? null, d.monthlyLimitHalire ?? null],
  );

  return NextResponse.json({ account: res.rows[0] }, { status: 201 });
}

async function PATCHImpl(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  const sets: string[] = [];
  const vals: unknown[] = [d.id];
  if (d.status !== undefined) { sets.push(`status = $${vals.length + 1}`); vals.push(d.status); }
  if (d.monthlyLimitHalire !== undefined) { sets.push(`monthly_limit_halire = $${vals.length + 1}`); vals.push(d.monthlyLimitHalire); }
  if (sets.length === 0) return NextResponse.json({ error: 'NOTHING_TO_UPDATE' }, { status: 422 });
  sets.push(`updated_at = NOW()`);

  const res = await db().query(
    `UPDATE platform.b2b_accounts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    vals,
  );
  if (res.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({ account: res.rows[0] });
}

// Obaleno kontextem platform admina (FINDINGS 110 / migrace 463).
// requirePlatformAdmin OVERUJE, ale GUC NENASTAVUJE — to dela az
// runAsPlatformAdmin (platform-auth.ts:55). Bez tohohle obaleni by 463
// spravu B2B uctu zavrela: app.is_platform_admin by nebylo nastavene
// a vetev app_is_platform_admin() by neplatila. Zmereno, ne odhadnuto.

export async function GET(...a: Parameters<typeof GETImpl>): Promise<Response> {
  return runWithPlatformAdminContext(() => GETImpl(...a));
}

export async function POST(...a: Parameters<typeof POSTImpl>): Promise<Response> {
  return runWithPlatformAdminContext(() => POSTImpl(...a));
}

export async function PATCH(...a: Parameters<typeof PATCHImpl>): Promise<Response> {
  return runWithPlatformAdminContext(() => PATCHImpl(...a));
}
