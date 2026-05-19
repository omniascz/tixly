/**
 * Multi-signal fraud scoring na order create.
 *
 * Signals:
 *   - velocity: kolik orderů z tohoto emailu/IP za poslední hodinu
 *   - email_pattern: disposable email domén (10minutemail, mailinator, ...)
 *   - high_value: order > X CZK ekvivalent
 *   - geo_mismatch: locale vs IP country (zatím stub — IP geo není implementováno)
 *   - card_bin: BIN check vs kontry shipping (zatím stub — mock payment)
 *   - new_user_high_value: nový email + high value = suspicious
 *   - bot_history: existující bot detection match (audit.bot_detections)
 *
 * Output:
 *   score 0-100, signals, decision: allow (0-40) / review (41-79) / block (80+)
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface FraudInput {
  email: string;
  ip: string | null;
  totalAmountMinor: number;
  currency: string;
  fingerprint?: string;
  isNewUser: boolean;
}

export interface FraudResult {
  score: number;
  signals: Record<string, unknown>;
  decision: 'allow' | 'review' | 'block';
}

const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'mailinator.com',
  'tempmail.com',
  'guerrillamail.com',
  'yopmail.com',
  'throwaway.email',
  'sharklasers.com',
  'temp-mail.org',
  'fakeinbox.com',
  'maildrop.cc',
]);

// High value thresholds per currency (minor units)
const HIGH_VALUE: Record<string, number> = {
  CZK: 1_000_000, // 10 000 CZK
  EUR: 50_000, // 500 EUR
  USD: 50_000,
  GBP: 40_000,
  PLN: 200_000,
};

export async function scoreFraud(input: FraudInput): Promise<FraudResult> {
  const signals: Record<string, unknown> = {};
  let score = 0;

  // 1) Disposable email
  const domain = input.email.split('@')[1]?.toLowerCase();
  if (domain && DISPOSABLE_DOMAINS.has(domain)) {
    score += 50;
    signals.disposableEmail = domain;
  }

  // 2) Email velocity (last 1h)
  const emailVelocity = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     WHERE LOWER(u.email) = LOWER($1) AND o.created_at > NOW() - INTERVAL '1 hour'`,
    [input.email],
  );
  const emailHits = Number(emailVelocity.rows[0]?.count ?? 0);
  signals.emailVelocity1h = emailHits;
  if (emailHits >= 5) score += 35;
  else if (emailHits >= 3) score += 20;

  // 3) IP velocity (last 1h)
  if (input.ip) {
    const ipVelocity = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit.bot_detections
       WHERE ip = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [input.ip],
    );
    const ipHits = Number(ipVelocity.rows[0]?.count ?? 0);
    signals.ipVelocity1h = ipHits;
    if (ipHits >= 10) score += 25;
    else if (ipHits >= 5) score += 15;
  }

  // 4) High value
  const threshold = HIGH_VALUE[input.currency] ?? HIGH_VALUE.CZK;
  signals.highValue = input.totalAmountMinor >= threshold;
  if (input.totalAmountMinor >= threshold) {
    score += 15;
    if (input.isNewUser) {
      score += 25; // new user + high value = highly suspicious
      signals.newUserHighValue = true;
    }
  }

  // 5) Bot detection history
  if (input.fingerprint) {
    const botHistory = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit.bot_detections
       WHERE fingerprint = $1 AND action_taken IN ('block', 'rate_limited', 'captcha_required')
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [input.fingerprint],
    );
    const botHits = Number(botHistory.rows[0]?.count ?? 0);
    signals.botHistory24h = botHits;
    if (botHits >= 3) score += 30;
    else if (botHits >= 1) score += 10;
  }

  let decision: FraudResult['decision'] = 'allow';
  if (score >= 80) decision = 'block';
  else if (score >= 41) decision = 'review';

  signals.totalScore = score;
  signals.computedAt = new Date().toISOString();

  return { score, signals, decision };
}
