import type {
  CreditWallet,
  CreditTransaction,
  DbAdapter,
} from '../types/referral.types';
import {
  CreditTransactionType,
  InsufficientCreditError,
} from '../types/referral.types';

// ============================================================
// Credit (Cashback Wallet) Service
//
// Všechny peněžní hodnoty jsou v INTEGER haléřích (1 Kč = 100 haléřů).
// ============================================================

/** Maximum fraction of an order value that can be paid with credit */
const MAX_CREDIT_FRACTION_BPS = 2000; // 20.00 %

interface WalletRow {
  user_id: string;
  balance_halire: string | number;
  lifetime_earned_halire: string | number;
  lifetime_spent_halire: string | number;
  updated_at: string;
}

interface TransactionRow {
  id: string;
  user_id: string;
  amount_halire: string | number;
  type: string;
  reference_id: string | null;
  description: string;
  created_at: string;
}

function toInt(value: string | number): number {
  return typeof value === 'number' ? value : parseInt(value, 10);
}

function mapWallet(row: WalletRow): CreditWallet {
  return {
    userId: row.user_id,
    balanceHalire: toInt(row.balance_halire),
    lifetimeEarnedHalire: toInt(row.lifetime_earned_halire),
    lifetimeSpentHalire: toInt(row.lifetime_spent_halire),
    updatedAt: new Date(row.updated_at),
  };
}

function mapTransaction(row: TransactionRow): CreditTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    amountHalire: toInt(row.amount_halire),
    type: row.type as CreditTransactionType,
    referenceId: row.reference_id,
    description: row.description,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Retrieve (or create an empty) credit wallet for a user.
 */
export async function getBalance(
  userId: string,
  db: DbAdapter,
): Promise<CreditWallet> {
  const row = await db.queryOne<WalletRow>(
    'SELECT * FROM referral.credit_wallet WHERE user_id = $1',
    [userId],
  );

  if (row) return mapWallet(row);

  // Return a zero-balance virtual wallet without persisting it
  return {
    userId,
    balanceHalire: 0,
    lifetimeEarnedHalire: 0,
    lifetimeSpentHalire: 0,
    updatedAt: new Date(),
  };
}

/**
 * Add credit to a user's wallet (positive amount, whole haléře).
 * UPSERTs the wallet row and inserts a credit_transaction record.
 */
export async function addCredit(
  userId: string,
  amountHalire: number,
  type: CreditTransactionType,
  referenceId: string,
  description: string,
  db: DbAdapter,
): Promise<void> {
  if (!Number.isInteger(amountHalire) || amountHalire <= 0) {
    throw new Error(`addCredit expects a positive integer haléř amount, got ${amountHalire}`);
  }

  const isReferralEarned = type === CreditTransactionType.ReferralEarned;

  if (isReferralEarned) {
    await db.execute(
      `INSERT INTO referral.credit_wallet
         (user_id, balance_halire, lifetime_earned_halire)
       VALUES ($1, $2, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET balance_halire         = referral.credit_wallet.balance_halire + $2,
           lifetime_earned_halire = referral.credit_wallet.lifetime_earned_halire + $2,
           updated_at             = NOW()`,
      [userId, amountHalire],
    );
  } else {
    await db.execute(
      `INSERT INTO referral.credit_wallet
         (user_id, balance_halire, lifetime_earned_halire)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id) DO UPDATE
       SET balance_halire = referral.credit_wallet.balance_halire + $2,
           updated_at     = NOW()`,
      [userId, amountHalire],
    );
  }

  await db.execute(
    `INSERT INTO referral.credit_transactions
       (user_id, amount_halire, type, reference_id, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, amountHalire, type, referenceId, description],
  );
}

/**
 * Deduct credit from a user's wallet (whole haléře).
 * Verifies the balance is sufficient before deducting.
 * The DB CHECK (balance_halire >= 0) acts as a final safety net.
 */
export async function spendCredit(
  userId: string,
  amountHalire: number,
  orderId: string,
  db: DbAdapter,
): Promise<void> {
  if (!Number.isInteger(amountHalire) || amountHalire <= 0) {
    throw new Error(`spendCredit expects a positive integer haléř amount, got ${amountHalire}`);
  }

  const wallet = await getBalance(userId, db);

  if (wallet.balanceHalire < amountHalire) {
    throw new InsufficientCreditError(wallet.balanceHalire, amountHalire);
  }

  await db.execute(
    `UPDATE referral.credit_wallet
     SET balance_halire        = balance_halire - $1,
         lifetime_spent_halire = lifetime_spent_halire + $1,
         updated_at            = NOW()
     WHERE user_id = $2`,
    [amountHalire, userId],
  );

  // Record the spend transaction (negative amount by convention)
  await db.execute(
    `INSERT INTO referral.credit_transactions
       (user_id, amount_halire, type, reference_id, description)
     VALUES ($1, $2, 'order_discount', $3, $4)`,
    [
      userId,
      -amountHalire,
      orderId,
      `Credit discount applied to order ${orderId}`,
    ],
  );
}

/**
 * Calculate the maximum credit that may be applied to an order (integer haléře).
 * Rule: min(current_balance, order_amount × 20 %).
 */
export function getMaxCreditDiscount(
  orderAmountHalire: number,
  creditBalanceHalire: number,
): number {
  const maxFromOrder = Math.floor((orderAmountHalire * MAX_CREDIT_FRACTION_BPS) / 10_000);
  return Math.min(creditBalanceHalire, maxFromOrder);
}

/**
 * Return full transaction history for a user, newest first.
 */
export async function getTransactionHistory(
  userId: string,
  db: DbAdapter,
): Promise<CreditTransaction[]> {
  const rows = await db.query<TransactionRow>(
    `SELECT * FROM referral.credit_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapTransaction);
}
