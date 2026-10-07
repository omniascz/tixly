/**
 * POST /api/p/[slug]/vouchers/checkout — buyer self-purchase voucheru
 *
 * Body: {
 *   amountKc, buyerEmail, buyerName, buyerPhone?,
 *   recipientEmail?, recipientName?, message?
 * }
 *
 * Flow:
 *   1) Resolve promoter podle slug-u (public)
 *   2) Generate unique voucher code
 *   3) Vytvoř guest user pokud chybí
 *   4) INSERT marketing.gift_vouchers (source='buyer_purchase', payment_status='pending',
 *      expires_at = NOW() + 3 years, payment_id = random UUID)
 *   5) Return { gatewayUrl: '/mock-voucher/[paymentId]' }
 *
 * DACH parity #P1-2 (Reservix Gutschein Self-Service pattern).
 */
import { randomBytes, randomUUID } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

const schema = z.object({
  amountKc: z.number().int().min(100).max(50000),
  buyerEmail: z.string().email().max(320),
  buyerName: z.string().min(1).max(120),
  buyerPhone: z.string().max(30).optional(),
  recipientEmail: z.string().email().max(320).optional(),
  recipientName: z.string().max(120).optional(),
  message: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }): Promise<Response> {
  const params = await props.params;
  return runWithServiceContext(async () => {

  if (!/^[a-z0-9-]{2,80}$/.test(params.slug)) {
    return NextResponse.json({ error: 'INVALID_SLUG' }, { status: 422 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const d = parsed.data;
  const amountHalire = d.amountKc * 100;

  // Veřejný endpoint (kdokoliv si může koupit poukaz od aktivního pořadatele) — běží
  // v servisním kontextu routy, bez admin práv.
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

    const promoterRes = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM platform.promoters WHERE slug = $1 AND status = 'active'`,
      [params.slug],
    );
    if (promoterRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'PROMOTER_NOT_FOUND' }, { status: 404 });
    }
    const promoter = promoterRes.rows[0];

    // Guest user pro buyer (email-based dedup, respektuje partial unique
    // index uq_identity_users_email_active WHERE anonymized_at IS NULL).
    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, phone, password_hash, gdpr_consent_at)
       VALUES ($1, $2, $3, '!guest', NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL
         DO UPDATE SET name = COALESCE(EXCLUDED.name, identity.users.name),
                       phone = COALESCE(EXCLUDED.phone, identity.users.phone),
                       updated_at = NOW()
       RETURNING id`,
      [d.buyerEmail.toLowerCase(), d.buyerName, d.buyerPhone ?? null],
    );
    const buyerUserId = userRes.rows[0].id;

    const paymentId = randomUUID();
    // 3-year validity (Reservix default)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 3);

    // Unique code (5 attempts max)
    let voucherId: string | null = null;
    let voucherCode: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        const r = await client.query<{ id: string }>(
          `INSERT INTO marketing.gift_vouchers
             (code, promoter_id, amount_halire, balance_halire, currency,
              issued_to_email, issued_by_user, expires_at,
              source, payment_id, payment_status,
              buyer_email, recipient_name, recipient_message)
           VALUES ($1, $2, $3, $3, 'CZK', $4, $5, $6,
                   'buyer_purchase', $7, 'pending',
                   $8, $9, $10)
           RETURNING id`,
          [
            code,
            promoter.id,
            amountHalire,
            d.recipientEmail?.toLowerCase() ?? null,
            buyerUserId,
            expiresAt.toISOString(),
            paymentId,
            d.buyerEmail.toLowerCase(),
            d.recipientName ?? null,
            d.message ?? null,
          ],
        );
        voucherId = r.rows[0].id;
        voucherCode = code;
        break;
      } catch (err) {
        const e = err as { code?: string };
        if (e.code !== '23505') throw err;
      }
    }
    if (!voucherId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'CODE_COLLISION', message: 'Generování kódu selhalo. Zkuste to znovu.' },
        { status: 500 },
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      voucherId,
      voucherCode,
      amountHalire,
      expiresAt: expiresAt.toISOString(),
      promoterName: promoter.name,
      paymentId,
      gatewayUrl: `/mock-voucher/${paymentId}`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/p/[slug]/vouchers/checkout]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
