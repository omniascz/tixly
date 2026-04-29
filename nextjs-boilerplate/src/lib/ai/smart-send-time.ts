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
