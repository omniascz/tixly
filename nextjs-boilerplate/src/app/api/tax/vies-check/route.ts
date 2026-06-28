/**
 * GET /api/tax/vies-check?vatNumber=DE123456789
 *
 * Public-ish endpoint (rate-limited) for frontend VAT number validation.
 * Used in:
 *   - B2B checkout form (buyer enters company VAT ID)
 *   - Promoter KYC/onboarding (EU partner VAT validation)
 *
 * Returns ViesCheckResult + reverseChargeApplicable for the current promoter's country.
 *
 * Rate limit: 10 checks per IP per minute (VAT validation is expensive).
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateVatNumber, isReverseChargeApplicable, getCountryCodeFromVat } from '@/lib/tax/vies';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const vatNumber = url.searchParams.get('vatNumber')?.trim();
  const sellerCountry = url.searchParams.get('sellerCountry')?.trim()?.toUpperCase();

  if (!vatNumber) {
    return NextResponse.json({ error: 'vatNumber required' }, { status: 400 });
  }
  if (vatNumber.length > 20) {
    return NextResponse.json({ error: 'vatNumber too long' }, { status: 400 });
  }

  const result = await validateVatNumber(vatNumber);

  const buyerCountry = getCountryCodeFromVat(vatNumber);
  const reverseChargeApplicable = sellerCountry && buyerCountry
    ? isReverseChargeApplicable(buyerCountry, sellerCountry) && result.isValid
    : false;

  return NextResponse.json({
    ...result,
    reverseChargeApplicable,
    note: reverseChargeApplicable
      ? 'Přenesená daňová povinnost (reverse charge) dle čl. 44 Směrnice 2006/112/ES. Faktura se vystaví bez DPH.'
      : null,
  });
}
