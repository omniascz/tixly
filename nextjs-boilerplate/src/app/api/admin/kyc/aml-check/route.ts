/**
 * POST /api/admin/kyc/aml-check
 *
 * Run full AML/sanctions check for a promoter.
 * Platform admin only.
 *
 * Steps:
 *   1. Load promoter (name, country, registration number, company age)
 *   2. Screen against sanctions lists (OpenSanctions or flag manual review)
 *   3. Compute AML risk score
 *   4. Store result in compliance.aml_checks
 *   5. Update platform.promoters.aml_status
 *
 * Body: { promoterId: string }
 *
 * If OPENSANCTIONS_API_KEY is not set, result = 'manual_review'.
 * If sanctions match found, result = 'match' and KYC reviewer is notified.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { screenSanctions, computeAmlRiskScore } from '@/lib/compliance/sanctions';
import { notifyPlatformAdmin } from '@/lib/notifications/platform-notify';

export const dynamic = 'force-dynamic';

interface PromoterRow {
  id: string;
  name: string;
  company_ico: string | null;
  eu_company_id: string | null;
  eu_country: string | null;
  country: string | null;
  vat_payer: boolean;
  ares_data: { found: boolean; age_months?: number } | null;
  created_at: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const userId = req.headers.get('x-user-id');
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminRes = await db().query<{ is_platform_admin: boolean }>(
      `SELECT is_platform_admin FROM identity.users WHERE id = $1`,
      [userId],
    );
    if (!adminRes.rows[0]?.is_platform_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as { promoterId?: string };
    if (!body.promoterId) return NextResponse.json({ error: 'promoterId required' }, { status: 400 });

    const pRes = await db().query<PromoterRow>(
      `SELECT id, name, company_ico, eu_company_id, eu_country, country,
              vat_payer, ares_data, created_at
       FROM platform.promoters WHERE id = $1`,
      [body.promoterId],
    );
    if (pRes.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const promoter = pRes.rows[0];

    const country = promoter.country ?? promoter.eu_country ?? 'CZ';
    const regNumber = promoter.company_ico ?? promoter.eu_company_id ?? undefined;
    const createdAt = new Date(promoter.created_at);
    const companyAgeMonths = Math.floor(
      (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30),
    );

    // Sanctions screening
    const sanctionsResult = await screenSanctions({
      name: promoter.name,
      country,
      registrationNumber: regNumber,
    });

    // AML risk scoring
    const amlRisk = computeAmlRiskScore({
      country,
      companyAgeMonths,
      isVatPayer: promoter.vat_payer,
      sanctionsResult,
    });

    const checkResult = sanctionsResult.isMatch
      ? 'match'
      : sanctionsResult.requiresManualReview
      ? 'manual_review'
      : 'clear';

    const amlStatus = sanctionsResult.isMatch
      ? 'flagged'
      : amlRisk.level === 'high'
      ? 'manual_review'
      : 'clear';

    // Store in audit log
    await db().query(
      `INSERT INTO compliance.aml_checks
         (promoter_id, check_type, result, provider, score, raw_response)
       VALUES ($1, 'full_aml', $2, $3, $4, $5)`,
      [
        body.promoterId,
        checkResult,
        sanctionsResult.provider,
        sanctionsResult.score,
        JSON.stringify({ sanctionsResult, amlRisk }),
      ],
    );

    // Update promoter status
    await db().query(
      `UPDATE platform.promoters
       SET aml_status = $2, sanctions_checked_at = NOW(),
           sanctions_match = $3, updated_at = NOW()
       WHERE id = $1`,
      [
        body.promoterId,
        amlStatus,
        sanctionsResult.isMatch ? JSON.stringify(sanctionsResult) : null,
      ],
    );

    // Notify admin on match
    if (sanctionsResult.isMatch || amlRisk.level === 'high') {
      try {
        await notifyPlatformAdmin({
          kind: 'aml_match',
          title: `[AML ${amlStatus.toUpperCase()}] ${promoter.name}`,
          body: `Risk level: ${amlRisk.level} (${amlRisk.score}/100)\nFactors: ${amlRisk.factors.join(', ')}\nSanctions datasets: ${sanctionsResult.datasets.join(', ') || 'none'}`,
          link: `/admin/kyc/${body.promoterId}`,
        });
      } catch {
        // best-effort
      }
    }

    return NextResponse.json({
      ok: true,
      amlStatus,
      riskLevel: amlRisk.level,
      riskScore: amlRisk.score,
      riskFactors: amlRisk.factors,
      sanctionsMatch: sanctionsResult.isMatch,
      sanctionsDatasets: sanctionsResult.datasets,
      requiresManualReview: sanctionsResult.requiresManualReview,
    });
  });
}
