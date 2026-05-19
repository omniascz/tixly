/**
 * Smart send-time predictor — pro jednoho usera vrátí best hour to send email.
 *
 * Algoritmus (production):
 *   1. Get past email opens (open events) → group by hour-of-day
 *   2. Pick top hour s nejvíc opens
 *   3. Pokud nemáme data → fallback: 10am Tue/Thu (industry best practice)
 *
 * Demo: zatím jen fallback (open tracking není v code).
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface SendTimeRequest {
  userId: string;
  userTimezone?: string;
}

export interface SendTimeResult {
  bestHourLocal: number; // 0-23
  bestDayOfWeek: number; // 0=Sun, 1=Mon, ...
  basis: 'historical' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
}

const FALLBACK_HOUR = 10;
const FALLBACK_DAY = 2; // Tuesday

export async function predictBestSendTime(_req: SendTimeRequest): Promise<SendTimeResult> {
  // V produkci by zde bylo: SELECT date_part('hour', opened_at) FROM marketing.email_opens WHERE user_id = $1 GROUP BY hour ORDER BY COUNT(*) DESC LIMIT 1
  // Pro demo: vrátíme fallback s low confidence
  return {
    bestHourLocal: FALLBACK_HOUR,
    bestDayOfWeek: FALLBACK_DAY,
    basis: 'fallback',
    confidence: 'low',
  };
}

export interface SegmentSendTimeRequest {
  promoterId: string;
  channel: 'email' | 'sms' | 'push' | 'inapp';
}

export interface SegmentSendTimeResult {
  bestHourLocal: number;
  bestDayOfWeek: number;
  basis: 'historical' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
  scheduledAtIso: string; // next occurrence of bestDay+bestHour in CET
  sampleSize: number;
}

/**
 * Aggregate level prediction přes celý segment kupců promotéra.
 * Sleduje historical opens v marketing.campaign_recipient_events
 * (předpoklad: ON event 'opened' has occurred_at). Pre-tracking fallback.
 */
export async function predictSegmentSendTime(
  req: SegmentSendTimeRequest,
): Promise<SegmentSendTimeResult> {
  const FALLBACK_DAY_OF_WEEK = req.channel === 'sms' ? 4 : 2; // pátek pro SMS, úterý pro email
  const FALLBACK_HOUR_OF_DAY = req.channel === 'sms' ? 17 : 10; // 17h pro SMS, 10h pro email

  let basis: 'historical' | 'fallback' = 'fallback';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let bestHour = FALLBACK_HOUR_OF_DAY;
  let bestDay = FALLBACK_DAY_OF_WEEK;
  let sampleSize = 0;

  try {
    const r = await db().query<{ hour: string; dow: string; count: string }>(
      `SELECT EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Europe/Prague')::text AS hour,
              EXTRACT(DOW FROM occurred_at AT TIME ZONE 'Europe/Prague')::text AS dow,
              COUNT(*)::text AS count
       FROM marketing.campaign_recipient_events
       WHERE event_type = 'opened'
         AND occurred_at > NOW() - INTERVAL '180 days'
         AND campaign_id IN (
           SELECT id FROM marketing.campaigns
           WHERE promoter_id = $1 AND channel = $2
         )
       GROUP BY hour, dow
       ORDER BY count DESC
       LIMIT 1`,
      [req.promoterId, req.channel],
    );
    if (r.rows.length > 0) {
      const top = r.rows[0];
      bestHour = Number(top.hour);
      bestDay = Number(top.dow);
      sampleSize = Number(top.count);
      basis = 'historical';
      confidence = sampleSize > 500 ? 'high' : sampleSize > 50 ? 'medium' : 'low';
    }
  } catch {
    // Pre-marketing tracking schema fallback
  }

  // Vypočítat nejbližší ISO datetime kdy bude bestDay v bestHour (next 7 days window)
  const now = new Date();
  const target = new Date(now);
  const currentDow = target.getUTCDay();
  let daysToAdd = (bestDay - currentDow + 7) % 7;
  if (daysToAdd === 0 && now.getUTCHours() >= bestHour) {
    daysToAdd = 7;
  }
  target.setUTCDate(target.getUTCDate() + daysToAdd);
  // bestHour je local (Europe/Prague), CET = UTC+1, CEST = UTC+2
  // Pro jednoduchost: UTC+1 (Tixly primárně CET, DST zanedbáme)
  target.setUTCHours(bestHour - 1, 0, 0, 0);

  return {
    bestHourLocal: bestHour,
    bestDayOfWeek: bestDay,
    basis,
    confidence,
    scheduledAtIso: target.toISOString(),
    sampleSize,
  };
}
