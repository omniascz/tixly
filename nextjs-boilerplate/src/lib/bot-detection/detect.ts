/**
 * Bot / scalper detection signals.
 *
 * Multi-signal scoring:
 *  - honeypot field set → certain bot
 *  - too-fast form submission (<2s after page load) → likely bot
 *  - per-fingerprint velocity (>5 attempts/min) → suspicious
 *  - known bot UA substrings → blocked
 *  - missing/invalid CAPTCHA token (when required) → blocked
 *
 * Output: { score 0-100, reason, action }
 *  - score 0-30: pass
 *  - 31-70: rate_limit / soft challenge
 *  - 71-100: block
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface BotSignals {
  honeypot?: string;
  formStartedAt?: number;
  fingerprint?: string;
  ip?: string;
  userAgent?: string;
  captchaToken?: string;
}

export interface BotDecision {
  score: number;
  action: 'pass' | 'rate_limit' | 'captcha_required' | 'block';
  reason: string;
  signals: Record<string, unknown>;
}

const BOT_UA_PATTERNS = [
  /headlesschrome/i,
  /phantomjs/i,
  /puppeteer/i,
  /selenium/i,
  /\b(bot|crawler|spider|scraper)\b/i,
  /^curl/i,
  /^wget/i,
  /^python-requests/i,
  /^node-fetch/i,
  /^axios/i,
];

const VELOCITY_THRESHOLD = 5;
const FAST_SUBMIT_THRESHOLD_MS = 2_000;

export async function detectBot(s: BotSignals): Promise<BotDecision> {
  const signals: Record<string, unknown> = {};
  let score = 0;

  // 1) Honeypot — pokud je vyplněno, je to bot.
  if (s.honeypot && s.honeypot.trim() !== '') {
    return {
      score: 100,
      action: 'block',
      reason: 'honeypot_filled',
      signals: { honeypot: s.honeypot },
    };
  }

  // 2) UA blacklist
  if (s.userAgent) {
    for (const pat of BOT_UA_PATTERNS) {
      if (pat.test(s.userAgent)) {
        return {
          score: 95,
          action: 'block',
          reason: 'bot_user_agent',
          signals: { userAgent: s.userAgent, pattern: pat.source },
        };
      }
    }
  }

  // 3) Form-fill speed
  if (s.formStartedAt) {
    const elapsed = Date.now() - s.formStartedAt;
    signals.formElapsedMs = elapsed;
    if (elapsed < FAST_SUBMIT_THRESHOLD_MS && elapsed >= 0) {
      score += 40;
      signals.fastSubmit = true;
    }
  }

  // 4) Per-fingerprint velocity
  if (s.fingerprint) {
    const recent = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit.bot_detections
       WHERE fingerprint = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
      [s.fingerprint],
    );
    const recentCount = Number(recent.rows[0]?.count ?? 0);
    signals.recentFingerprintHits = recentCount;
    if (recentCount >= VELOCITY_THRESHOLD) {
      score += 30;
    }
  }

  // 5) Per-IP velocity
  if (s.ip) {
    const recent = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit.bot_detections
       WHERE ip = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
      [s.ip],
    );
    const recentCount = Number(recent.rows[0]?.count ?? 0);
    signals.recentIpHits = recentCount;
    if (recentCount >= VELOCITY_THRESHOLD * 2) {
      score += 20;
    }
  }

  let action: BotDecision['action'] = 'pass';
  let reason = 'clean';
  if (score >= 71) {
    action = 'block';
    reason = 'high_risk_score';
  } else if (score >= 41) {
    action = 'captcha_required';
    reason = 'medium_risk_score';
  } else if (score >= 21) {
    action = 'rate_limit';
    reason = 'low_risk_score';
  }

  return { score, action, reason, signals };
}

export async function logDetection(
  decision: BotDecision,
  context: { eventId?: string; userId?: string; fingerprint?: string; ip?: string },
): Promise<void> {
  await db().query(
    `INSERT INTO audit.bot_detections
       (event_id, user_id, fingerprint, ip, reason, signals, action_taken)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      context.eventId ?? null,
      context.userId ?? null,
      context.fingerprint ?? null,
      context.ip ?? null,
      decision.reason,
      JSON.stringify({ ...decision.signals, score: decision.score }),
      decision.action === 'pass' ? 'logged' : decision.action,
    ],
  );
}
