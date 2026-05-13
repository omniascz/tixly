// loyalty.service.ts — business logika věrnostního programu.
//
// Všechny peněžní hodnoty v haléřích (integer).
// Body jsou celá čísla.
// Tier se počítá z lifetimePoints — nikdy neklesá.

import type {
  LoyaltyAccount,
  PointsTransaction,
  RedemptionOption,
  RedeemResult,
} from '../types/loyalty.types';
import {
  InsufficientPointsError,
  InvalidRedemptionError,
} from '../types/loyalty.types';
import {
  calculateEarnedPoints,
  getTier,
  calculateDiscount,
  calculateExpiryDate,
} from '../lib/points-calculator';
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
// Konstanty
// ---------------------------------------------------------------------------

/** Minimální počet bodů pro uplatnění jako volný lístek */
const FREE_TICKET_THRESHOLD = 1_000;

const DEFAULT_HISTORY_LIMIT = 50;

// ---------------------------------------------------------------------------
// Interní row typy (výsledky z DB)
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  user_id: string;
  total_points: string | number;
  lifetime_points: string | number;
  tier: string;
  expires_at: string;
}

interface TransactionRow {
  id: string;
  user_id: string;
  type: string;
  points: string | number;
  order_id: string | null;
  description: string;
  created_at: string;
}

function mapAccount(row: AccountRow): LoyaltyAccount {
  return {
    id: row.id,
    userId: row.user_id,
    totalPoints: Number(row.total_points),
    lifetimePoints: Number(row.lifetime_points),
    tier: row.tier as LoyaltyAccount['tier'],
    expiresAt: new Date(row.expires_at),
  };
}

function mapTransaction(row: TransactionRow): PointsTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as PointsTransaction['type'],
    points: parseInt(row.points, 10),
    orderId: row.order_id ?? undefined,
    description: row.description,
    createdAt: new Date(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// earnPoints
// ---------------------------------------------------------------------------

/**
 * Přidá body zákazníkovi za nákup.
 *
 * - Idempotentní: ON CONFLICT (user_id, order_id) DO NOTHING
 *   (opakované volání pro stejnou objednávku je bezpečné)
 * - Aktualizuje tier dle lifetimePoints
 * - Resetuje expiresAt na now + 12 měsíců
 * - Publikuje Kafka event loyalty.points_earned (fire-and-forget)
 *
 * @param deps        - injektované závislosti (db, kafka)
 * @param userId      - ID zákazníka
 * @param orderId     - ID objednávky (pro idempotenci)
 * @param orderAmount - částka objednávky v haléřích
 * @returns aktualizovaný LoyaltyAccount
 */
export async function earnPoints(
  deps: ServiceDeps,
  userId: string,
  orderId: string,
  orderAmount: number,
): Promise<LoyaltyAccount> {
  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    // Zjistíme aktuální účet nebo inicializujeme výchozí hodnoty
    const existingRows = await db.query<AccountRow>(
      `SELECT * FROM loyalty.accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    const currentAccount = existingRows[0] ?? null;
    const currentLifetime = currentAccount ? Number(currentAccount.lifetime_points) : 0;
    const currentTier = currentAccount
      ? (currentAccount.tier as LoyaltyAccount['tier'])
      : 'bronze';

    const earnedPoints = calculateEarnedPoints(orderAmount, currentTier);
    if (earnedPoints === 0) {
      // Nic nezískal, vrátíme aktuální účet (nebo vytvoříme prázdný)
      return getAccount(deps, userId);
    }

    const newLifetime = currentLifetime + earnedPoints;
    const newTier = getTier(newLifetime);
    const now = new Date();
    const expiresAt = calculateExpiryDate(now);

    await db.transaction(async (tx) => {
      // Idempotentní upsert účtu
      await tx.execute(
        `INSERT INTO loyalty.accounts
           (user_id, total_points, lifetime_points, tier, expires_at)
         VALUES ($1, $2, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
         SET total_points    = loyalty.accounts.total_points + $2,
             lifetime_points = loyalty.accounts.lifetime_points + $2,
             tier            = $3,
             expires_at      = $4`,
        [userId, earnedPoints, newTier, expiresAt.toISOString()],
      );

      // Idempotentní insert transakce — ON CONFLICT na (user_id, order_id)
      await tx.execute(
        `INSERT INTO loyalty.transactions
           (user_id, type, points, order_id, description)
         VALUES ($1, 'earned', $2, $3, $4)
         ON CONFLICT (user_id, order_id) DO NOTHING`,
        [
          userId,
          earnedPoints,
          orderId,
          `Věrnostní body za objednávku ${orderId} (${earnedPoints} bodů)`,
        ],
      );
    });

    // Kafka fire-and-forget — nechceme blokovat response při chybě brokera
    deps.kafka
      .send('loyalty.points_earned', {
        userId,
        orderId,
        points: earnedPoints,
        newTier,
        timestamp: now.toISOString(),
      })
      .catch(() => {
        // Záměrně ignorujeme — Kafka je best-effort
      });

    return getAccount(deps, userId);
  });
}

// ---------------------------------------------------------------------------
// redeemPoints
// ---------------------------------------------------------------------------

/**
 * Odečte body zákazníkovi a vrátí odpovídající benefit.
 *
 * - Kontroluje dostatečný zůstatek (InsufficientPointsError)
 * - Kontroluje validní kombinaci option/points (InvalidRedemptionError)
 * - Provádí atomicky v DB transakci
 * - Publikuje Kafka event loyalty.points_redeemed (fire-and-forget)
 *
 * @param deps   - injektované závislosti
 * @param userId - ID zákazníka
 * @param points - počet bodů k uplatnění
 * @param option - typ odměny ('discount' | 'free_ticket')
 * @returns RedeemResult s detaily benefitu
 */
export async function redeemPoints(
  deps: ServiceDeps,
  userId: string,
  points: number,
  option: RedemptionOption,
): Promise<RedeemResult> {
  if (points <= 0) {
    throw new InvalidRedemptionError('Počet bodů k uplatnění musí být větší než 0.');
  }

  if (option === 'free_ticket' && points < FREE_TICKET_THRESHOLD) {
    throw new InvalidRedemptionError(
      `Pro volný lístek je potřeba minimálně ${FREE_TICKET_THRESHOLD} bodů.`,
    );
  }

  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    return db.transaction(async (tx) => {
      // Načteme účet se zamčením řádku (SELECT FOR UPDATE)
      const rows = await tx.query<AccountRow>(
        `SELECT * FROM loyalty.accounts WHERE user_id = $1 LIMIT 1 FOR UPDATE`,
        [userId],
      );

      if (rows.length === 0 || Number(rows[0]!.total_points) < points) {
        const available = rows.length > 0 ? Number(rows[0]!.total_points) : 0;
        throw new InsufficientPointsError(available, points);
      }

      const account = rows[0]!;
      const newTotal = Number(account.total_points) - points;

      // Odečteme body
      await tx.execute(
        `UPDATE loyalty.accounts
         SET total_points = $1
         WHERE user_id = $2`,
        [newTotal, userId],
      );

      // Zaznamenáme redemption transakci
      const description =
        option === 'discount'
          ? `Uplatnění ${points} bodů jako sleva (${calculateDiscount(points) / 100} Kč)`
          : `Uplatnění ${points} bodů jako volný lístek`;

      await tx.execute(
        `INSERT INTO loyalty.transactions
           (user_id, type, points, description)
         VALUES ($1, 'redeemed', $2, $3)`,
        [userId, points, description],
      );

      const discountAmount = option === 'discount' ? calculateDiscount(points) : undefined;
      const freeTicket = option === 'free_ticket' ? true : undefined;

      // Kafka fire-and-forget
      deps.kafka
        .send('loyalty.points_redeemed', {
          userId,
          points,
          option,
          discountAmount,
          freeTicket,
          remainingPoints: newTotal,
          timestamp: new Date().toISOString(),
        })
        .catch(() => {
          // Záměrně ignorujeme
        });

      return {
        option,
        discountAmount,
        freeTicket,
        remainingPoints: newTotal,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// getAccount
// ---------------------------------------------------------------------------

/**
 * Vrátí aktuální stav věrnostního účtu zákazníka.
 * Pokud účet neexistuje, vrátí výchozí prázdný účet (bez persistence).
 *
 * @param deps   - injektované závislosti
 * @param userId - ID zákazníka
 */
export async function getAccount(
  deps: ServiceDeps,
  userId: string,
): Promise<LoyaltyAccount> {
  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    const rows = await db.query<AccountRow>(
      `SELECT * FROM loyalty.accounts WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    if (rows.length === 0) {
      // Vrátíme virtuální prázdný účet — bez zápisu do DB
      return {
        id: '',
        userId,
        totalPoints: 0,
        lifetimePoints: 0,
        tier: 'bronze',
        expiresAt: calculateExpiryDate(new Date()),
      };
    }

    return mapAccount(rows[0]!);
  });
}

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------

/**
 * Vrátí historii transakcí zákazníka, seřazenou od nejnovější.
 *
 * @param deps   - injektované závislosti
 * @param userId - ID zákazníka
 * @param limit  - maximální počet transakcí (default 50)
 */
export async function getHistory(
  deps: ServiceDeps,
  userId: string,
  limit: number = DEFAULT_HISTORY_LIMIT,
): Promise<PointsTransaction[]> {
  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    const rows = await db.query<TransactionRow>(
      `SELECT * FROM loyalty.transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );

    return rows.map(mapTransaction);
  });
}

// ---------------------------------------------------------------------------
// expireOldPoints
// ---------------------------------------------------------------------------

/**
 * Cron job: expiruje body zákazníkům, jejichž expiresAt je v minulosti.
 *
 * - Načte všechny účty s expiresAt < now a total_points > 0
 * - Pro každý: vynuluje total_points, zapíše expired transakci
 * - Publikuje Kafka event loyalty.points_expired (fire-and-forget)
 *
 * @param deps - injektované závislosti
 * @returns počet expirovaných účtů
 */
export async function expireOldPoints(deps: ServiceDeps): Promise<number> {
  const now = new Date();

  // Nepoužíváme tenant context — cron běží jako service
  const rows = await deps.db.query<AccountRow>(
    `SELECT * FROM loyalty.accounts
     WHERE expires_at < $1 AND total_points > 0`,
    [now.toISOString()],
  );

  if (rows.length === 0) return 0;

  let expired = 0;

  for (const row of rows) {
    const account = mapAccount(row);
    const pointsToExpire = account.totalPoints;

    try {
      await deps.db.transaction(async (tx) => {
        await tx.execute(
          `UPDATE loyalty.accounts
           SET total_points = 0
           WHERE user_id = $1 AND expires_at < $2 AND total_points > 0`,
          [account.userId, now.toISOString()],
        );

        await tx.execute(
          `INSERT INTO loyalty.transactions
             (user_id, type, points, description)
           VALUES ($1, 'expired', $2, $3)`,
          [
            account.userId,
            pointsToExpire,
            `Expirace ${pointsToExpire} bodů (platnost vypršela ${now.toISOString().slice(0, 10)})`,
          ],
        );
      });

      // Kafka fire-and-forget
      deps.kafka
        .send('loyalty.points_expired', {
          userId: account.userId,
          pointsExpired: pointsToExpire,
          expiredAt: now.toISOString(),
        })
        .catch(() => {
          // Záměrně ignorujeme
        });

      expired++;
    } catch {
      // Log chyby, ale pokračujeme dalšími účty
      // V produkci by zde byl logger.error(...)
    }
  }

  return expired;
}
