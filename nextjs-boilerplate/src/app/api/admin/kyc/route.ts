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
import { isValidCzDic } from '@/lib/tax/vat';


const submitSchema = z.object({
  ico: z.string().regex(/^\d{8}$/, 'IČO musí být 8 čísel'),
  dic: z.string().max(30).optional(),
  companyName: z.string().min(2).max(200),
  companyAddress: z.string().min(5).max(500),
  bankAccount: z.string().min(5).max(60),
  vatPayer: z.boolean().default(true),
  // Kolo 7 (C-54): sazba pořadatele je ZASTARALÁ — doklady berou sazbu z typu vstupenky.
  vatRatePct: z.number().int().min(0).max(50).optional(),
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

  // Kolo 7 (C-54): plátce DPH musí mít platné DIČ (CZ + 8–10 číslic) — zadané nebo z ARES.
  if (parsed.data.vatPayer && parsed.data.dic && !isValidCzDic(parsed.data.dic)) {
    return NextResponse.json(
      { error: 'DIC_INVALID', message: 'Plátce DPH musí mít platné DIČ ve tvaru CZ + 8–10 číslic.' },
      { status: 422 },
    );
  }

  // ARES verification
  // Kolo 7: výpadek / timeout ARES → údaje přijmeme k RUČNÍMU ověření platform adminem
  // (manual_verification_required); neexistující IČO dál 422.
  const ares = await verifyIco(parsed.data.ico);
  const manualVerification = ares.unavailable;
  if (!ares.valid && !manualVerification) {
    return NextResponse.json(
      { error: 'ARES_VERIFICATION_FAILED', details: ares.error },
      { status: 422 },
    );
  }

  const dic = parsed.data.dic ?? ares.dic ?? null;
  if (parsed.data.vatPayer && !isValidCzDic(dic)) {
    return NextResponse.json(
      { error: 'DIC_REQUIRED', message: 'Plátce DPH musí mít DIČ (nezadáno a ARES ho neuvádí).' },
      { status: 422 },
    );
  }

  // Po zjednodušené registraci (e-mail+heslo) je promoters.name placeholder
  // odvozený z e-mailu. KYC je první autoritativní ověření firmy → přepiš name
  // ověřeným právním názvem z ARES. (slug zatím zůstává — viz onboarding TODO.)
  // Bez ARES (ruční ověření) se použije zadaný název; ares_verified_at zůstane prázdné.
  await db().query(
    `UPDATE platform.promoters
     SET name = COALESCE(NULLIF($9, ''), name),
         company_ico = $2, company_dic = $3, company_address = $4,
         bank_account = $5, vat_rate_pct = COALESCE($6, vat_rate_pct), vat_payer = $7,
         kyc_status = 'submitted', kyc_submitted_at = NOW(),
         ares_verified_at = CASE WHEN $10 THEN NULL ELSE NOW() END, ares_data = $8::jsonb,
         ares_check_status = CASE WHEN $10 THEN 'unavailable' WHEN $11 THEN 'verified' ELSE 'inactive' END,
         manual_verification_required = $10,
         updated_at = NOW()
     WHERE id = $1`,
    [
      promoter.promoterId,
      ares.ico,
      dic,
      parsed.data.companyAddress,
      parsed.data.bankAccount,
      parsed.data.vatRatePct ?? null,
      parsed.data.vatPayer,
      JSON.stringify(ares),
      manualVerification ? parsed.data.companyName : (ares.companyName ?? ''),
      manualVerification,
      ares.active !== false,
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
    manualVerification,
    status: 'submitted',
  });

  });
}
