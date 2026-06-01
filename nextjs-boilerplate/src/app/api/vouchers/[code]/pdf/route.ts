/**
 * GET /api/vouchers/[code]/pdf?locale=cs|sk|en
 *
 * Vrátí branded PDF voucher. Public endpoint — voucher code samotný je
 * "shared secret" (uniformní pseudo-random alphabet, brute-force safe).
 *
 * Nepoužívá auth — voucher je dárkový poukaz, příjemce ho možná dostane
 * emailem bez Tixly accountu.
 *
 * Cache: 5 minut (balance se může změnit po redemption).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { renderVoucherPdf } from '@/lib/vouchers/voucher-pdf';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  return runWithServiceContext(async () => {

  const { code } = await params;
  if (!/^[A-Z0-9-]{8,40}$/i.test(code)) {
    return NextResponse.json({ error: 'INVALID_CODE' }, { status: 400 });
  }

  const localeParam = req.nextUrl.searchParams.get('locale');
  const locale: 'cs' | 'sk' | 'en' =
    localeParam === 'sk' ? 'sk' : localeParam === 'en' ? 'en' : 'cs';

  const r = await db().query<{
    code: string;
    amount_halire: number;
    balance_halire: number;
    currency: string;
    issued_to_email: string | null;
    expires_at: string | null;
    promoter_name: string;
    brand_color_hex: string | null;
    brand_logo_url: string | null;
  }>(
    `SELECT gv.code, gv.amount_halire, gv.balance_halire, gv.currency,
            gv.issued_to_email, gv.expires_at::text,
            p.name AS promoter_name, p.brand_color_hex, p.brand_logo_url
       FROM marketing.gift_vouchers gv
       LEFT JOIN platform.promoters p ON p.id = gv.promoter_id
      WHERE UPPER(gv.code) = UPPER($1)`,
    [code],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'VOUCHER_NOT_FOUND' }, { status: 404 });
  }
  const v = r.rows[0];

  if (v.expires_at && new Date(v.expires_at) < new Date()) {
    return NextResponse.json({ error: 'VOUCHER_EXPIRED' }, { status: 410 });
  }

  const pdf = await renderVoucherPdf({
    code: v.code,
    amountHalire: v.amount_halire,
    balanceHalire: v.balance_halire,
    currency: v.currency,
    promoterName: v.promoter_name ?? 'Tixly',
    brandColorHex: v.brand_color_hex,
    brandLogoUrl: v.brand_logo_url,
    issuedToEmail: v.issued_to_email,
    expiresAt: v.expires_at,
    locale,
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="voucher-${v.code}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  });

  });
}
