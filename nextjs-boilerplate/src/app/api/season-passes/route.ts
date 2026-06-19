import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';

interface ProductRow {
  id: string;
  title: string;
  description: string | null;
  price_halire: number;
  total_uses: number;
  valid_from: string | null;
  valid_until: string;
  max_per_buyer: number | null;
  is_active: boolean;
  promoter_slug: string;
  promoter_name: string;
  promoter_id: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const promoterSlug = req.nextUrl.searchParams.get('promoterSlug');
    if (!promoterSlug) {
      return NextResponse.json({ error: 'promoterSlug required' }, { status: 400 });
    }
    const r = await db().query<ProductRow>(
      `SELECT spp.*, p.slug AS promoter_slug, p.name AS promoter_name, p.id AS promoter_id
       FROM catalog.season_pass_products spp
       JOIN platform.promoters p ON p.id = spp.promoter_id
       WHERE p.slug = $1 AND spp.is_active = true AND spp.valid_until > NOW()
       ORDER BY spp.price_halire ASC`,
      [promoterSlug],
    );
    return NextResponse.json({
      products: r.rows.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        priceHalire: p.price_halire,
        totalUses: p.total_uses,
        validFrom: p.valid_from,
        validUntil: p.valid_until,
        maxPerBuyer: p.max_per_buyer,
        promoterSlug: p.promoter_slug,
        promoterName: p.promoter_name,
        promoterId: p.promoter_id,
      })),
    });
  });
}

const purchaseSchema = z.object({
  productId: z.string().uuid(),
  buyerEmail: z.string().email().optional(),
  buyerName: z.string().min(1).max(120).optional(),
  paymentMethod: z.enum(['gopay', 'wero', 'przelewy24', 'bank_transfer']).default('gopay'),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = purchaseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    const headerUserId = req.headers.get('x-user-id');

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const productRes = await client.query<{
        id: string;
        promoter_id: string;
        title: string;
        price_halire: number;
        total_uses: number;
        valid_from: string | null;
        valid_until: string;
        max_per_buyer: number | null;
        is_active: boolean;
      }>(
        `SELECT * FROM catalog.season_pass_products WHERE id = $1 FOR UPDATE`,
        [input.productId],
      );
      if (productRes.rows.length === 0 || !productRes.rows[0].is_active) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'PRODUCT_NOT_AVAILABLE' }, { status: 422 });
      }
      const product = productRes.rows[0];
      if (new Date(product.valid_until).getTime() < Date.now()) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'PRODUCT_EXPIRED' }, { status: 422 });
      }

      let userId: string;
      let buyerEmail: string;
      let buyerName: string;

      if (headerUserId) {
        userId = headerUserId;
        const uRes = await client.query<{ email: string; name: string }>(
          `SELECT email, name FROM identity.users WHERE id = $1`,
          [userId],
        );
        if (uRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 401 });
        }
        buyerEmail = uRes.rows[0].email;
        buyerName = uRes.rows[0].name;
      } else if (input.buyerEmail) {
        buyerEmail = input.buyerEmail.toLowerCase();
        buyerName = input.buyerName ?? buyerEmail;
        const uRes = await client.query<{ id: string }>(
          `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
           VALUES ($1, $2, '!guest', NOW(), NOW(), NOW())
           ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [buyerEmail, buyerName],
        );
        userId = uRes.rows[0].id;
      } else {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
      }

      if (product.max_per_buyer) {
        const alreadyRes = await client.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM orders.season_passes
           WHERE product_id = $1 AND holder_user_id = $2`,
          [product.id, userId],
        );
        if (Number(alreadyRes.rows[0].cnt) >= product.max_per_buyer) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'MAX_PER_BUYER_REACHED', max: product.max_per_buyer }, { status: 409 });
        }
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const paymentId = randomUUID();

      const orderRes = await client.query<{ id: string }>(
        `INSERT INTO orders.orders
           (user_id, event_id, status, total_amount, currency, locale,
            gopay_payment_id, payment_provider, idempotency_key,
            discount_halire, service_fee_minor,
            expires_at, created_at, updated_at)
         VALUES ($1, NULL, 'pending', $2, 'CZK', 'cs',
                 $3, $4, $5,
                 0, 0,
                 NOW() + INTERVAL '15 minutes', NOW(), NOW())
         RETURNING id`,
        [userId, product.price_halire, paymentId, input.paymentMethod, randomUUID()],
      );
      const orderId = orderRes.rows[0].id;

      const passRes = await client.query<{ id: string; pass_token: string }>(
        `INSERT INTO orders.season_passes
           (product_id, order_id, holder_user_id, holder_email, holder_name,
            uses_remaining, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, pass_token`,
        [
          product.id,
          orderId,
          userId,
          buyerEmail,
          buyerName,
          product.total_uses,
          product.valid_until,
        ],
      );

      await client.query('COMMIT');

      const { createPayment } = await import('@/lib/payment/provider');
      const paymentSession = await createPayment({
        orderId,
        amountHalire: product.price_halire,
        currency: 'CZK',
        buyerEmail,
        buyerName,
        description: `Sezónní pas: ${product.title}`,
        paymentMethod: input.paymentMethod,
        appUrl,
      });

      if (paymentSession.paymentId !== paymentId) {
        await db().query(
          `UPDATE orders.orders SET gopay_payment_id = $2, updated_at = NOW() WHERE id = $1`,
          [orderId, paymentSession.paymentId],
        );
      }

      return NextResponse.json({
        passId: passRes.rows[0].id,
        passToken: passRes.rows[0].pass_token,
        orderId,
        gatewayUrl: paymentSession.gatewayUrl,
      }, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST /api/season-passes]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
