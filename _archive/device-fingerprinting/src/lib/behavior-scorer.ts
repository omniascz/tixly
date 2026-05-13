export interface BehaviorSignals {
  mouseMovements: number;       // total events captured
  mouseVarianceX: number;       // px stddev — bots have low variance
  mouseVarianceY: number;
  clickCount: number;
  /** Avg ms between clicks — bots are too fast or too uniform */
  avgClickIntervalMs: number;
  /** Stddev of click intervals */
  clickIntervalStddev: number;
  keyPressCount: number;
  timeOnPageMs: number;
  /** Number of focus/blur events — humans switch tabs */
  focusBlurCount: number;
  /** Did the page detect any touch events (mobile)? */
  hasTouchEvents: boolean;
}

export interface BehaviorScore {
  score: number;        // 0..100, higher = more bot-like
  reasons: string[];    // human-readable signals that contributed
  level: 'human' | 'suspicious' | 'bot';
}

/**
 * Scores a set of user behavior signals and classifies them as human,
 * suspicious, or bot. Higher score = more bot-like.
 */
export function scoreBehavior(signals: BehaviorSignals): BehaviorScore {
  const reasons: string[] = [];
  let score = 0;

  // Synthetic clicks: clicks without any mouse movement at all.
  if (signals.mouseMovements === 0 && signals.clickCount > 0) {
    score += 40;
    reasons.push('synthetic_clicks: clicks without mouse movement');
  }

  // Low mouse variance — bots tend to move in straight lines / not at all.
  // Only penalise when we actually captured movements; otherwise the
  // synthetic-click rule above already covers the no-movement case.
  if (signals.mouseMovements > 0) {
    const avgVariance = (signals.mouseVarianceX + signals.mouseVarianceY) / 2;
    if (avgVariance < 5) {
      score += 30;
      reasons.push(`low_mouse_variance: ${avgVariance.toFixed(1)}px avg stddev`);
    }
  }

  // Clicks too fast to be human.
  if (signals.clickCount >= 2 && signals.avgClickIntervalMs > 0 && signals.avgClickIntervalMs < 50) {
    score += 25;
    reasons.push(`clicks_too_fast: ${signals.avgClickIntervalMs}ms avg interval`);
  }

  // Click cadence too uniform (bot timing).
  if (signals.clickCount >= 3 && signals.clickIntervalStddev < 10) {
    score += 20;
    reasons.push(`uniform_click_cadence: ${signals.clickIntervalStddev.toFixed(1)}ms stddev`);
  }

  // Purchasing within < 1s of page load.
  if (signals.timeOnPageMs < 1000) {
    score += 30;
    reasons.push(`rushed_checkout: ${signals.timeOnPageMs}ms on page`);
  }

  // No keyboard or focus interaction at all on a long session — mildly suspicious.
  if (signals.timeOnPageMs > 5000 && signals.keyPressCount === 0 && signals.focusBlurCount === 0 && !signals.hasTouchEvents) {
    score += 5;
    reasons.push('no_interaction_signals');
  }

  if (score > 100) score = 100;
  if (score < 0) score = 0;

  const level: BehaviorScore['level'] =
    score >= 70 ? 'bot' : score >= 30 ? 'suspicious' : 'human';

  return { score, reasons, level };
}
