// Ambassador Service
//
// Flow:
//   1. Promotér zaregistruje ambassadora (createAmbassador)
//   2. Promotér přidělí promo kód (assignCode)
//   3. Fanoušek použije kód při nákupu (useCode) — atomická transakce
//   4. Ambassador sleduje výkonnost (getStats)
//   5. Ambassador si vyžádá výplatu (requestPayout) min. 500 Kč (50 000 haléřů)

import { generateAmbassadorCode, isValidAmbassadorCode } from '../lib/code-generator';
import {
  AmbassadorNotFoundError,
  CodeExhaustedError,
  AmbassadorSuspendedError,
} from '../types/ambassador.types';
import type {
  Ambassador,
  AmbassadorCode,
  AmbassadorStats,
} from '../types/ambassador.types';
import { withTenantContext } from '@tixly/rls-multitenancy';
import type { DbAdapter } from '@tixly/rls-multitenancy';

interface KafkaAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}
export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaAdapter;
}

// ---------------------------------------------------------------------------
// createAmbassador — promotér registruje nového ambassadora
// ---------------------------------------------------------------------------
export async function createAmbassador(
  deps: ServiceDeps,
  promoterId: string,
  params: {
    userId: string;
    name: string;
    tier?: Ambassador['tier'];
    commissionRateBps: number;
  },
): Promise<Ambassador> {
  if (!Number.isInteger(params.commissionRateBps) || params.commissionRateBps < 0 || params.commissionRateBps > 3000) {
    throw new RangeError('commissionRateBps musí být celé číslo 0–3000 (0–30 %)');
  }

  return withTenantContext(deps.db, { promoterId, role: 'promoter' }, async (db) => {
    const tier = params.tier ?? 'bronze';
    const [row] = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO ambassador.ambassadors
         (user_id, promoter_id, name, tier, commission_rate_bps, wallet_balance, status)
       VALUES ($1, $2, $3, $4, $5, 0, 'active')
       RETURNING id, created_at`,
      [params.userId, promoterId, params.name, tier, params.commissionRateBps],
    );

    return {
      id: row.id,
      userId: params.userId,
      promoterId,
      name: params.name,
      tier,
      commissionRateBps: params.commissionRateBps,
      walletBalance: 0,
      status: 'active',
      createdAt: row.created_at,
    };
  });
}

// ---------------------------------------------------------------------------
// assignCode — přidělí ambassadorovi nový promo kód
// ---------------------------------------------------------------------------
export async function assignCode(
  deps: ServiceDeps,
  promoterId: string,
  ambassadorId: string,
  params: {
    maxUses: number;
    discountBps: number;
    validUntil: Date;
  },
): Promise<AmbassadorCode> {
  if (!Number.isInteger(params.discountBps) || params.discountBps < 0 || params.discountBps > 5000) {
    throw new RangeError('discountBps musí být celé číslo 0–5000 (0–50 %)');
  }
  if (!Number.isInteger(params.maxUses) || params.maxUses < 1) {
    throw new RangeError('maxUses musí být kladné celé číslo');
  }

  return withTenantContext(deps.db, { promoterId, role: 'promoter' }, async (db) => {
    // Ověř existenci ambassadora a tenant ownership. Cross-tenant → NOT_FOUND (anti-enum).
    const [amb] = await db.query<{ status: string }>(
      `SELECT status FROM ambassador.ambassadors WHERE id = $1 AND promoter_id = $2`,
      [ambassadorId, promoterId],
    );
    if (!amb) throw new AmbassadorNotFoundError(`Ambassador ${ambassadorId} nenalezen.`);
    if (amb.status === 'suspended') throw new AmbassadorSuspendedError(`Ambassador ${ambassadorId} je suspendován.`);

    // Generuj unikátní kód s retry při kolizi
    let code = generateAmbassadorCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const [existing] = await db.query<{ id: string }>(
        `SELECT id FROM ambassador.codes WHERE code = $1`,
        [code],
      );
      if (!existing) break;
      code = generateAmbassadorCode();
    }

    const [row] = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO ambassador.codes
         (ambassador_id, code, max_uses, used_count, discount_bps, valid_until)
       VALUES ($1, $2, $3, 0, $4, $5)
       RETURNING id, created_at`,
      [ambassadorId, code, params.maxUses, params.discountBps, params.validUntil],
    );

    return {
      id: row.id,
      ambassadorId,
      code,
      maxUses: params.maxUses,
      usedCount: 0,
      discountBps: params.discountBps,
      validUntil: params.validUntil,
      createdAt: row.created_at,
    };
  });
}

// ---------------------------------------------------------------------------
// useCode — atomické použití kódu při nákupu (DB transakce)
// ---------------------------------------------------------------------------
export async function useCode(
  deps: ServiceDeps,
  code: string,
  orderId: string,
  orderAmount: number,
): Promise<{ discountBps: number; commission: number }> {
  if (!isValidAmbassadorCode(code)) {
    throw new AmbassadorNotFoundError(`Neplatný formát kódu: ${code}`);
  }
  if (!Number.isInteger(orderAmount) || orderAmount < 0) {
    throw new RangeError('orderAmount musí být nezáporné celé číslo v haléřích');
  }

  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    return db.transaction(async (tx) => {
      // Načti kód + ambassadora — zamkni řádek pro atomický update
      const [row] = await tx.query<{
        code_id: string;
        ambassador_id: string;
        max_uses: number;
        used_count: number;
        discount_bps: number;
        valid_until: Date;
        ambassador_status: string;
        commission_rate_bps: number;
      }>(
        `SELECT c.id AS code_id, c.ambassador_id, c.max_uses, c.used_count,
                c.discount_bps, c.valid_until,
                a.status AS ambassador_status, a.commission_rate_bps
           FROM ambassador.codes c
           JOIN ambassador.ambassadors a ON a.id = c.ambassador_id
          WHERE c.code = $1
          FOR UPDATE`,
        [code],
      );

      if (!row) throw new AmbassadorNotFoundError(`Kód ${code} nenalezen.`);

      if (row.ambassador_status === 'suspended') {
        throw new AmbassadorSuspendedError(`Ambassador kódu ${code} je suspendován.`);
      }

      if (row.used_count >= row.max_uses) {
        throw new CodeExhaustedError(`Kód ${code} byl již vyčerpán (${row.used_count}/${row.max_uses}).`);
      }

      if (new Date() > new Date(row.valid_until)) {
        throw new CodeExhaustedError(`Kód ${code} vypršel.`);
      }

      // Výpočet provize — celé haléře
      const commission = Math.floor((orderAmount * row.commission_rate_bps) / 10_000);

      // Atomický increment + idempotentní záznam použití (ON CONFLICT DO NOTHING)
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO ambassador.code_usages (code_id, order_id, order_amount, commission)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_id) DO NOTHING
         RETURNING id`,
        [row.code_id, orderId, orderAmount, commission],
      );

      // Pokud ON CONFLICT DO NOTHING → řádek nebyl vložen → idempotentní návrat
      if (inserted.length === 0) {
        return { discountBps: row.discount_bps, commission: 0 };
      }

      // Increment used_count
      await tx.execute(
        `UPDATE ambassador.codes SET used_count = used_count + 1 WHERE id = $1`,
        [row.code_id],
      );

      // Přičti provizi do wallet ambassadora
      await tx.execute(
        `UPDATE ambassador.ambassadors
            SET wallet_balance = wallet_balance + $1
          WHERE id = $2`,
        [commission, row.ambassador_id],
      );

      deps.kafka.send('tixly.ambassador.code-used', {
        code,
        orderId,
        ambassadorId: row.ambassador_id,
        orderAmount,
        commission,
        discountBps: row.discount_bps,
      }).catch(() => {});

      return { discountBps: row.discount_bps, commission };
    });
  });
}

// ---------------------------------------------------------------------------
// getStats — výkonnostní statistiky ambassadora
// ---------------------------------------------------------------------------
export async function getStats(
  deps: ServiceDeps,
  ambassadorId: string,
  userId: string,
): Promise<AmbassadorStats> {
  return withTenantContext(deps.db, { userId, role: 'ambassador' }, async (db) => {
    // Ověř vlastnictví
    const [amb] = await db.query<{ id: string }>(
      `SELECT id FROM ambassador.ambassadors WHERE id = $1 AND user_id = $2`,
      [ambassadorId, userId],
    );
    if (!amb) throw new AmbassadorNotFoundError(`Ambassador ${ambassadorId} nenalezen nebo nepatří uživateli.`);

    const [row] = await db.query<{
      total_sales: number;
      total_commission: number;
      codes_used: number;
      total_codes: number;
    }>(
      `SELECT
         COALESCE(SUM(u.order_amount), 0)::int AS total_sales,
         COALESCE(SUM(u.commission), 0)::int   AS total_commission,
         COUNT(u.id)::int                       AS codes_used,
         (SELECT COUNT(*)::int FROM ambassador.codes WHERE ambassador_id = $1) AS total_codes
       FROM ambassador.codes c
       LEFT JOIN ambassador.code_usages u ON u.code_id = c.id
       WHERE c.ambassador_id = $1`,
      [ambassadorId],
    );

    const totalCodes = row?.total_codes ?? 0;
    const codesUsed = row?.codes_used ?? 0;
    const conversionRate = totalCodes > 0
      ? Math.round((codesUsed / totalCodes) * 10_000) / 100
      : 0;

    return {
      ambassadorId,
      totalSales: row?.total_sales ?? 0,
      totalCommission: row?.total_commission ?? 0,
      codesUsed,
      conversionRate,
    };
  });
}

// ---------------------------------------------------------------------------
// listAmbassadors — seznam ambassadorů pro pořadatele
// ---------------------------------------------------------------------------
export async function listAmbassadors(
  deps: ServiceDeps,
  promoterId: string,
): Promise<Ambassador[]> {
  return withTenantContext(deps.db, { promoterId, role: 'promoter' }, async (db) => {
    const rows = await db.query<{
      id: string; user_id: string; promoter_id: string; name: string;
      tier: Ambassador['tier']; commission_rate_bps: number;
      wallet_balance: number; status: Ambassador['status']; created_at: Date;
    }>(
      `SELECT id, user_id, promoter_id, name, tier, commission_rate_bps,
              wallet_balance, status, created_at
         FROM ambassador.ambassadors
        WHERE promoter_id = $1
        ORDER BY created_at DESC`,
      [promoterId],
    );

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      promoterId: r.promoter_id,
      name: r.name,
      tier: r.tier,
      commissionRateBps: r.commission_rate_bps,
      walletBalance: r.wallet_balance,
      status: r.status,
      createdAt: r.created_at,
    }));
  });
}

// ---------------------------------------------------------------------------
// requestPayout — výplata z peněženky (minimum 50 000 haléřů = 500 Kč)
// ---------------------------------------------------------------------------
const PAYOUT_MINIMUM_HALERE = 50_000;

export interface PayoutResult {
  id: string;
  ambassadorId: string;
  amount: number;
  status: 'pending';
  createdAt: Date;
}

export async function requestPayout(
  deps: ServiceDeps,
  ambassadorId: string,
  userId: string,
): Promise<PayoutResult> {
  return withTenantContext(deps.db, { userId, role: 'ambassador' }, async (db) => {
    return db.transaction(async (tx) => {
      const [amb] = await tx.query<{
        wallet_balance: number; status: string;
      }>(
        `SELECT wallet_balance, status
           FROM ambassador.ambassadors
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [ambassadorId, userId],
      );

      if (!amb) throw new AmbassadorNotFoundError(`Ambassador ${ambassadorId} nenalezen.`);
      if (amb.status === 'suspended') throw new AmbassadorSuspendedError(`Ambassador ${ambassadorId} je suspendován.`);

      if (amb.wallet_balance < PAYOUT_MINIMUM_HALERE) {
        throw new RangeError(
          `Zůstatek ${amb.wallet_balance} haléřů nedosahuje minima ${PAYOUT_MINIMUM_HALERE} haléřů (500 Kč).`,
        );
      }

      const amount = amb.wallet_balance;

      // Atomicky: vynuluj wallet a vytvoř záznam výplaty -- tenant-scoped
      await tx.execute(
        `UPDATE ambassador.ambassadors SET wallet_balance = 0 WHERE id = $1 AND user_id = $2`,
        [ambassadorId, userId],
      );

      const [payout] = await tx.query<{ id: string; created_at: Date }>(
        `INSERT INTO ambassador.payouts (ambassador_id, amount, status)
         VALUES ($1, $2, 'pending')
         RETURNING id, created_at`,
        [ambassadorId, amount],
      );

      deps.kafka.send('tixly.ambassador.payout-requested', {
        ambassadorId,
        amount,
      }).catch(() => {});

      return {
        id: payout.id,
        ambassadorId,
        amount,
        status: 'pending' as const,
        createdAt: payout.created_at,
      };
    });
  });
}
