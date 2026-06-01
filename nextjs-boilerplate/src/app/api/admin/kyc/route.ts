/**
 * GET  /api/admin/kyc — promoterův current KYC status + data
 * POST /api/admin/kyc — submit KYC údaje (IČO, DIČ, address, bank)
 *                       Volá ARES API pro IČO verification.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterOwner } from '@/lib/admin-auth';
import { z } from 'zod';
import { verifyIco } from '@/lib/ares/verify';


const submitSchema = z.object({
  ico: z.string().regex(/^\d{8}$/, 'IČO musí být 8 čísel'),
  dic: z.string().max(30).optional(),
  companyName: z.string().min(2).max(200),
  companyAddress: z.string().min(5).max(500),
  bankAccount: z.string().min(5).max(60),
  vatPayer: z.boolean().default(true),
  vatRatePct: z.number().int().min(0).max(50).default(21),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{
    id: string;
    name: string;
    kyc_status: string;
    kyc_submitted_at: string | null;
    kyc_reviewed_at: string | null;
    kyc_rejection_reason: string | null;
    company_ico: string | null;
    company_dic: string | null;
    company_address: string | null;
    bank_account: string | null;
    vat_rate_pct: number;
    vat_payer: boolean;
    ares_verified_at: string | null;
    ares_data: unknown;
  }>(
    `SELECT id, name, kyc_status, kyc_submitted_at, kyc_reviewed_at, kyc_rejection_reason,
            company_ico, company_dic, company_address, bank_account,
            vat_rate_pct, vat_payer, ares_verified_at, ares_data
     FROM platform.promoters WHERE id = $1`,
    [promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const documents = await db().query<{
    id: string;
    type: string;
    file_url: string;
    file_name: string | null;
    created_at: string;
  }>(
    `SELECT id, type, file_url, file_name, created_at
     FROM platform.promoter_documents
     WHERE promoter_id = $1
     ORDER BY created_at DESC`,
    [promoter.promoterId],
  );
  return NextResponse.json({
    promoter: r.rows[0],
    documents: documents.rows,
  });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterOwner(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // ARES verification
  const ares = await verifyIco(parsed.data.ico);
  if (!ares.valid) {
    return NextResponse.json(
      { error: 'ARES_VERIFICATION_FAILED', details: ares.error },
      { status: 422 },
    );
  }

  await db().query(
    `UPDATE platform.promoters
     SET company_ico = $2, company_dic = $3, company_address = $4,
         bank_account = $5, vat_rate_pct = $6, vat_payer = $7,
         kyc_status = 'submitted', kyc_submitted_at = NOW(),
         ares_verified_at = NOW(), ares_data = $8::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      promoter.promoterId,
      ares.ico,
      parsed.data.dic ?? ares.dic ?? null,
      parsed.data.companyAddress,
      parsed.data.bankAccount,
      parsed.data.vatRatePct,
      parsed.data.vatPayer,
      JSON.stringify(ares),
    ],
  );

  return NextResponse.json({
    ok: true,
    aresData: {
      companyName: ares.companyName,
      address: ares.address,
      dic: ares.dic,
      active: ares.active,
    },
    status: 'submitted',
  });

  });
}
