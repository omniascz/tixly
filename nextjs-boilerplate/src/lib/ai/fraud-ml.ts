/**
 * AI fraud detection — weighted multi-feature scoring (logistic-style).
 *
 * Replaces P.3 hard-coded rules with calibrated weights. V produkci by zde byl
 * trained ML model (gradient-boosted trees nebo small NN) loaded ze súboru.
 * Demo: hand-tuned weights inspired by Stripe Radar / Sift Science papers.
 *
 * Each feature → number in [0, 1], multiplied by weight, sigmoid → final probability.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
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

const HIGH_VALUE: Record<string, number> = {
  CZK: 1_000_000,
  EUR: 50_000,
  USD: 50_000,
  GBP: 40_000,
  PLN: 200_000,
};

export interface MLFraudInput {
  email: string;
  ip: string | null;
  totalAmountMinor: number;
  currency: string;
  fingerprint?: string;
  isNewUser: boolean;
  buyerName?: string;
  cardCountry?: string;
  ipCountry?: string;
  formElapsedMs?: number;
}

export interface MLFraudResult {
  score: number; // 0-100
  probability: number; // 0-1
  decision: 'allow' | 'review' | 'block';
  features: Record<string, number>;
  topReasons: string[];
}

const WEIGHTS = {
  disposableEmail: 3.5,
  emailVelocity: 2.5,
  ipVelocity: 2.0,
  highValue: 1.0,
  newUserHighValue: 2.5,
  botHistory: 3.0,
  geoMismatch: 2.0,
  fastFormFill: 1.8,
  emailNamePatternMismatch: 1.2,
};

// Bias term — adjusts baseline (negative = less likely to flag baseline)
const BIAS = -3.5;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export async function scoreFraudML(input: MLFraudInput): Promise<MLFraudResult> {
  const features: Record<string, number> = {};

  // 1) Disposable email (binary)
  const domain = input.email.split('@')[1]?.toLowerCase();
  features.disposableEmail = domain && DISPOSABLE_DOMAINS.has(domain) ? 1 : 0;

  // 2) Email velocity — last 1h
  const ev = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     WHERE LOWER(u.email) = LOWER($1) AND o.created_at > NOW() - INTERVAL '1 hour'`,
    [input.email],
  );
  features.emailVelocity = Math.min(1, Number(ev.rows[0]?.count ?? 0) / 5);

  // 3) IP velocity — last 1h via bot_detections + orders
  if (input.ip) {
    const iv = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit.bot_detections
       WHERE ip = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [input.ip],
    );
    features.ipVelocity = Math.min(1, Number(iv.rows[0]?.count ?? 0) / 10);
  } else {
    features.ipVelocity = 0;
  }

  // 4) High value
  const threshold = HIGH_VALUE[input.currency] ?? HIGH_VALUE.CZK!;
  features.highValue = input.totalAmountMinor >= threshold ? 1 : 0;

  // 5) New user × high value (interaction)
  features.newUserHighValue = input.isNewUser && features.highValue ? 1 : 0;

  // 6) Bot history (24h)
  if (input.fingerprint) {
    const bh = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit.bot_detections
       WHERE fingerprint = $1 AND action_taken IN ('block','rate_limited','captcha_required')
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [input.fingerprint],
    );
    features.botHistory = Math.min(1, Number(bh.rows[0]?.count ?? 0) / 3);
  } else {
    features.botHistory = 0;
  }

  // 7) Geo mismatch (card country vs IP country)
  features.geoMismatch =
    input.cardCountry && input.ipCountry && input.cardCountry !== input.ipCountry ? 1 : 0;

  // 8) Fast form fill (<2s)
  features.fastFormFill = input.formElapsedMs !== undefined && input.formElapsedMs < 2000 ? 1 : 0;

  // 9) Email/name pattern mismatch (bot generators často emit jméno/email rozdílné)
  if (input.buyerName) {
    const localPart = input.email.split('@')[0]!.toLowerCase().replace(/[._-]/g, '');
    const nameNoSpace = input.buyerName.toLowerCase().replace(/\s/g, '');
    const overlap = nameNoSpace.length > 3 && localPart.includes(nameNoSpace.slice(0, 3));
    features.emailNamePatternMismatch = overlap ? 0 : 0.5;
  } else {
    features.emailNamePatternMismatch = 0;
  }

  // Linear combination
  let logit = BIAS;
  for (const [k, v] of Object.entries(features)) {
    const w = (WEIGHTS as Record<string, number>)[k] ?? 0;
    logit += w * v;
  }
  const probability = sigmoid(logit);
  const score = Math.round(probability * 100);

  let decision: MLFraudResult['decision'] = 'allow';
  if (score >= 75) decision = 'block';
  else if (score >= 40) decision = 'review';

  // Top reasons: features that contributed most positive logit
  const contributions = Object.entries(features)
    .map(([k, v]) => ({ k, contrib: ((WEIGHTS as Record<string, number>)[k] ?? 0) * v }))
    .filter((c) => c.contrib > 0)
    .sort((a, b) => b.contrib - a.contrib)
    .slice(0, 3)
    .map((c) => c.k);

  return {
    score,
    probability,
    decision,
    features,
    topReasons: contributions,
  };
}
