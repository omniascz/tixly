// Affiliate Service — správa affiliate účtů, linků, konverzí a peněženky.
//
// Flow:
//   1. Promotér zaregistruje affiliata (createAffiliate) → nastaví commissionRateBps
//   2. Affiliate vytvoří tracking link (createLink) → dostane code (base62)
//   3. Sdílí https://tixly.cz/r/{code} → trackClick → redirect + cookie
//   4. Fan koupí → recordConversion → přidá komisi do wallet
//   5. Při wallet >= threshold → requestPayout

import { generateAffiliateCode, calculateCommission, isValidAffiliateCode } from '../lib/link-generator';
import {
  AffiliateLinkNotFoundError,
  AffiliateNotActiveError,
  PayoutThresholdNotReachedError,
  DuplicateConversionError,
} from '../types/affiliate.types';
import type {
  Affiliate, AffiliateLink, AffiliateConversion, AffiliatePayout,
} from '../types/affiliate.types';
import { withTenantContext } from '@tixly/rls-multitenancy';
import type { DbAdapter } from '@tixly/rls-multitenancy';

interface KafkaAdapter { send(topic: string, payload: unknown): Promise<void>; }
interface ServiceDeps { db: DbAdapter; kafka: KafkaAdapter; }

// ---------------------------------------------------------------------------
// createAffiliate
// ---------------------------------------------------------------------------
export async function createAffiliate(
  deps: ServiceDeps,
  promoterId: string,
  params: { userId: string; commissionRateBps: number; payoutThreshold?: number },
): Promise<Affiliate> {
  if (params.commissionRateBps < 0 || params.commissionRateBps > 5000) {
    throw new RangeError('commissionRateBps musí být 0–5000 (0–50 %)');
  }

  return withTenantContext(deps.db, { promoterId, role: 'promoter' }, async (db) => {
    const [row] = await db.query<{
      id: string; created_at: Date;
    }>(
      `INSERT INTO affiliate.affiliates
         (user_id, promoter_id, commission_rate_bps, wallet_balance, payout_threshold, status)
       VALUES ($1, $2, $3, 0, $4, 'active')
       RETURNING id, created_at`,
      [params.userId, promoterId, params.commissionRateBps, params.payoutThreshold ?? 50000],
    );

    return {
      id: row.id,
      userId: params.userId,
      promoterId,
      commissionRateBps: params.commissionRateBps,
      walletBalance: 0,
      payoutThreshold: params.payoutThreshold ?? 50000,
      status: 'active',
      createdAt: row.created_at,
    };
  });
}

// ---------------------------------------------------------------------------
// createLink
// ---------------------------------------------------------------------------
export async function createLink(
  deps: ServiceDeps,
  affiliateId: string,
  userId: string,
  params: { eventId?: string },
): Promise<AffiliateLink> {
  return withTenantContext(deps.db, { userId, role: 'promoter' }, async (db) => {
    // Ověř že affiliate je aktivní
    const [aff] = await db.query<{ status: string }>(
      `SELECT status FROM affiliate.affiliates WHERE id = $1 AND user_id = $2`,
      [affiliateId, userId],
    );
    if (!aff || aff.status !== 'active') {
      throw new AffiliateNotActiveError('Affiliate účet není aktivní.');
    }

    // Generuj unikátní kód — retry při kolizi (extrémně nepravděpodobné)
    let code = generateAffiliateCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const [existing] = await db.query<{ id: string }>(
        `SELECT id FROM affiliate.links WHERE code = $1`, [code],
      );
      if (!existing) break;
      code = generateAffiliateCode();
    }

    const [row] = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO affiliate.links (affiliate_id, event_id, code)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [affiliateId, params.eventId ?? null, code],
    );

    return {
      id: row.id,
      affiliateId,
      eventId: params.eventId ?? null,
      code,
      clickCount: 0,
      conversionCount: 0,
      createdAt: row.created_at,
    };
  });
}

// ---------------------------------------------------------------------------
// trackClick — zaznamená klik a vrátí cílové URL pro redirect
// ---------------------------------------------------------------------------
export async function trackClick(
  deps: ServiceDeps,
  code: string,
  sessionId: string,
  referrer: string | null,
): Promise<{ redirectUrl: string; cookieTtlDays: number }> {
  if (!isValidAffiliateCode(code)) {
    throw new AffiliateLinkNotFoundError(`Neplatný affiliate kód: ${code}`);
  }

  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    const [link] = await db.query<{
      id: string; event_id: string | null; affiliate_status: string;
    }>(
      `SELECT l.id, l.event_id, a.status AS affiliate_status
         FROM affiliate.links l
         JOIN affiliate.affiliates a ON a.id = l.affiliate_id
        WHERE l.code = $1`,
      [code],
    );

    if (!link || link.affiliate_status !== 'active') {
      throw new AffiliateLinkNotFoundError(`Affiliate link ${code} nenalezen nebo neaktivní.`);
    }

    // Zaznamenej klik (fire and forget pattern — neblokuje redirect)
    db.execute(
      `INSERT INTO affiliate.clicks (link_id, session_id, referrer)
       VALUES ($1, $2, $3)`,
      [link.id, sessionId, referrer],
    ).catch(() => {});

    // Increment click counter
    db.execute(
      `UPDATE affiliate.links SET click_count = click_count + 1 WHERE id = $1`,
      [link.id],
    ).catch(() => {});

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz';
    const redirectUrl = link.event_id
      ? `${baseUrl}/cs/akce/${link.event_id}`
      : `${baseUrl}/cs/akce`;

    deps.kafka.send('tixly.affiliate.click', { code, linkId: link.id, sessionId }).catch(() => {});

    return { redirectUrl, cookieTtlDays: 30 };
  });
}

// ---------------------------------------------------------------------------
// recordConversion — volá se po úspěšné platbě (Kafka consumer nebo webhook)
// ---------------------------------------------------------------------------
export async function recordConversion(
  deps: ServiceDeps,
  params: {
    orderId: string;
    orderAmount: number;   // haléře
    affiliateCode: string;
  },
): Promise<AffiliateConversion> {
  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    return db.transaction(async (tx) => {
      // Načti link + affiliate
      const [link] = await tx.query<{
        id: string; affiliate_id: string; commission_rate_bps: number;
      }>(
        `SELECT l.id, l.affiliate_id, a.commission_rate_bps
           FROM affiliate.links l
           JOIN affiliate.affiliates a ON a.id = l.affiliate_id
          WHERE l.code = $1 AND a.status = 'active'`,
        [params.affiliateCode],
      );

      if (!link) throw new AffiliateLinkNotFoundError(`Affiliate kód ${params.affiliateCode} nenalezen.`);

      const commission = calculateCommission(params.orderAmount, link.commission_rate_bps);

      // Idempotentní INSERT — zabrání dvojímu připsání komise
      const rows = await tx.query<{ id: string; created_at: Date }>(
        `INSERT INTO affiliate.conversions
           (link_id, affiliate_id, order_id, order_amount, commission, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (order_id) DO NOTHING
         RETURNING id, created_at`,
        [link.id, link.affiliate_id, params.orderId, params.orderAmount, commission],
      );

      if (rows.length === 0) throw new DuplicateConversionError(`Konverze pro objednávku ${params.orderId} již existuje.`);

      // Přidej komisi do wallet
      await tx.execute(
        `UPDATE affiliate.affiliates
         SET wallet_balance = wallet_balance + $1
         WHERE id = $2`,
        [commission, link.affiliate_id],
      );

      // Increment conversion counter
      await tx.execute(
        `UPDATE affiliate.links SET conversion_count = conversion_count + 1 WHERE id = $1`,
        [link.id],
      );

      deps.kafka.send('tixly.affiliate.conversion', {
        orderId: params.orderId,
        affiliateId: link.affiliate_id,
        commission,
      }).catch(() => {});

      return {
        id: rows[0].id,
        linkId: link.id,
        affiliateId: link.affiliate_id,
        orderId: params.orderId,
        orderAmount: params.orderAmount,
        commission,
        status: 'pending' as const,
        createdAt: rows[0].created_at,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// requestPayout — affiliate požádá o výplatu
// ---------------------------------------------------------------------------
export async function requestPayout(
  deps: ServiceDeps,
  affiliateId: string,
  userId: string,
): Promise<AffiliatePayout> {
  return withTenantContext(deps.db, { userId, role: 'promoter' }, async (db) => {
    return db.transaction(async (tx) => {
      const [aff] = await tx.query<{
        wallet_balance: number; payout_threshold: number; status: string;
      }>(
        `SELECT wallet_balance, payout_threshold, status
           FROM affiliate.affiliates
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [affiliateId, userId],
      );

      if (!aff || aff.status !== 'active') throw new AffiliateNotActiveError('Affiliate účet nenalezen nebo neaktivní.');

      if (aff.wallet_balance < aff.payout_threshold) {
        throw new PayoutThresholdNotReachedError(
          `Zůstatek ${aff.wallet_balance} haléřů je pod minimem ${aff.payout_threshold} haléřů.`,
          aff.wallet_balance,
          aff.payout_threshold,
        );
      }

      const amount = aff.wallet_balance;

      // Nulování peněženky + vytvoření výplaty atomicky
      await tx.execute(
        `UPDATE affiliate.affiliates SET wallet_balance = 0 WHERE id = $1`,
        [affiliateId],
      );

      const [payout] = await tx.query<{ id: string; created_at: Date }>(
        `INSERT INTO affiliate.payouts (affiliate_id, amount, status)
         VALUES ($1, $2, 'pending')
         RETURNING id, created_at`,
        [affiliateId, amount],
      );

      deps.kafka.send('tixly.affiliate.payout-requested', { affiliateId, amount }).catch(() => {});

      return {
        id: payout.id,
        affiliateId,
        amount,
        status: 'pending' as const,
        createdAt: payout.created_at,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// getLinkStats — statistiky konkrétního linku
// ---------------------------------------------------------------------------
export async function getLinkStats(
  deps: ServiceDeps,
  code: string,
  userId: string,
): Promise<{
  code: string;
  clicks: number;
  conversions: number;
  totalOrderAmount: number;
  totalCommission: number;
  conversionRate: number;
}> {
  return withTenantContext(deps.db, { userId, role: 'promoter' }, async (db) => {
    const [row] = await db.query<{
      code: string; click_count: number; conversion_count: number;
      total_order_amount: number; total_commission: number;
    }>(
      `SELECT l.code, l.click_count, l.conversion_count,
              COALESCE(SUM(c.order_amount), 0)::int AS total_order_amount,
              COALESCE(SUM(c.commission), 0)::int AS total_commission
         FROM affiliate.links l
         LEFT JOIN affiliate.conversions c ON c.link_id = l.id AND c.status != 'reversed'
        WHERE l.code = $1
          AND l.affiliate_id IN (SELECT id FROM affiliate.affiliates WHERE user_id = $2)
        GROUP BY l.code, l.click_count, l.conversion_count`,
      [code, userId],
    );

    if (!row) throw new AffiliateLinkNotFoundError(`Link ${code} nenalezen.`);

    return {
      code: row.code,
      clicks: row.click_count,
      conversions: row.conversion_count,
      totalOrderAmount: row.total_order_amount,
      totalCommission: row.total_commission,
      conversionRate: row.click_count > 0
        ? Math.round((row.conversion_count / row.click_count) * 10000) / 100
        : 0,
    };
  });
}
