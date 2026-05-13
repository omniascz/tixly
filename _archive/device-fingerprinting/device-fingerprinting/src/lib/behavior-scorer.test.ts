import { describe, it, expect } from 'vitest';
import { scoreBehavior, BehaviorSignals } from './behavior-scorer.js';

function baseHuman(overrides: Partial<BehaviorSignals> = {}): BehaviorSignals {
  return {
    mouseMovements: 250,
    mouseVarianceX: 120,
    mouseVarianceY: 90,
    clickCount: 4,
    avgClickIntervalMs: 1200,
    clickIntervalStddev: 450,
    keyPressCount: 12,
    timeOnPageMs: 45_000,
    focusBlurCount: 2,
    hasTouchEvents: false,
    ...overrides,
  };
}

describe('scoreBehavior', () => {
  it('classifies realistic human behavior as human', () => {
    const result = scoreBehavior(baseHuman());
    expect(result.level).toBe('human');
    expect(result.score).toBeLessThan(30);
  });

  it('classifies synthetic clicks (no mouse movement) as suspicious', () => {
    const result = scoreBehavior(baseHuman({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 3,
    }));
    // synthetic_clicks +40 → score=40, level=suspicious (30-69)
    expect(result.level).toBe('suspicious');
    expect(result.score).toBe(40);
    expect(result.reasons.some(r => r.includes('synthetic_clicks'))).toBe(true);
  });

  it('flags low mouse variance', () => {
    const result = scoreBehavior(baseHuman({
      mouseVarianceX: 2,
      mouseVarianceY: 3,
    }));
    expect(result.reasons.some(r => r.includes('low_mouse_variance'))).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it('flags clicks faster than 50ms apart', () => {
    const result = scoreBehavior(baseHuman({
      avgClickIntervalMs: 20,
      clickIntervalStddev: 2,
    }));
    expect(result.reasons.some(r => r.includes('clicks_too_fast'))).toBe(true);
    expect(result.reasons.some(r => r.includes('uniform_click_cadence'))).toBe(true);
  });

  it('flags rushed checkout under 1s', () => {
    const result = scoreBehavior(baseHuman({
      timeOnPageMs: 500,
    }));
    expect(result.reasons.some(r => r.includes('rushed_checkout'))).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it('combines multiple bot signals into bot level', () => {
    const result = scoreBehavior({
      mouseMovements: 5,
      mouseVarianceX: 1,
      mouseVarianceY: 1,
      clickCount: 5,
      avgClickIntervalMs: 30,
      clickIntervalStddev: 2,
      keyPressCount: 0,
      timeOnPageMs: 300,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    expect(result.level).toBe('bot');
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('caps score at 100', () => {
    const result = scoreBehavior({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 10,
      avgClickIntervalMs: 10,
      clickIntervalStddev: 1,
      keyPressCount: 0,
      timeOnPageMs: 100,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.level).toBe('bot');
  });

  it('leaves mobile touch users alone', () => {
    const result = scoreBehavior(baseHuman({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 0,
      hasTouchEvents: true,
    }));
    expect(result.level).toBe('human');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Extended Coverage: Behavior Scoring Edge Cases & Risk Assessment
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreBehavior — edge cases (all zeros = human)', () => {
  it('all zeros with touch events = suspicious (rushed checkout)', () => {
    const result = scoreBehavior({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 0,
      avgClickIntervalMs: 0,
      clickIntervalStddev: 0,
      keyPressCount: 0,
      timeOnPageMs: 0,
      focusBlurCount: 0,
      hasTouchEvents: true,
    });
    // timeOnPageMs=0 < 1000 → rushed_checkout +30
    expect(result.score).toBe(30);
    expect(result.level).toBe('suspicious');
  });

  it('all zeros without touch = rushed checkout (score 30)', () => {
    const result = scoreBehavior({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 0,
      avgClickIntervalMs: 0,
      clickIntervalStddev: 0,
      keyPressCount: 0,
      timeOnPageMs: 0,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    // 0 clicks + 0 movements → no synthetic_clicks penalty
    // timeOnPageMs=0 < 1000 → rushed_checkout +30
    expect(result.score).toBe(30);
    expect(result.level).toBe('suspicious');
  });

  it('minimal human interaction (few clicks, some movement)', () => {
    const result = scoreBehavior(baseHuman({
      clickCount: 1,
      mouseMovements: 10,
      timeOnPageMs: 2000,
    }));
    expect(result.level).toBe('human');
    expect(result.score).toBeLessThan(50);
  });
});

describe('scoreBehavior — synthetic clicks detection', () => {
  it('detects clicks without mouse movement as synthetic (suspicious)', () => {
    const result = scoreBehavior({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 5,
      avgClickIntervalMs: 1200,
      clickIntervalStddev: 450,
      keyPressCount: 0,
      timeOnPageMs: 5000,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    // synthetic_clicks +40 → 40 = suspicious
    expect(result.level).toBe('suspicious');
    expect(result.score).toBe(40);
    expect(result.reasons.some(r => r.includes('synthetic_clicks'))).toBe(true);
  });

  it('allows clicks with substantial mouse movement', () => {
    const result = scoreBehavior(baseHuman({
      clickCount: 8,
      mouseMovements: 400,
      mouseVarianceX: 200,
      mouseVarianceY: 180,
    }));
    expect(result.level).toBe('human');
  });

  it('flags uniform click cadence (machine-like timing)', () => {
    const result = scoreBehavior({
      mouseMovements: 50,
      mouseVarianceX: 30,
      mouseVarianceY: 20,
      clickCount: 4,
      avgClickIntervalMs: 500,
      clickIntervalStddev: 5, // Very low std dev = uniform spacing
      keyPressCount: 2,
      timeOnPageMs: 5000,
      focusBlurCount: 1,
      hasTouchEvents: false,
    });
    expect(result.reasons.some(r => r.includes('uniform_click_cadence'))).toBe(true);
  });
});

describe('scoreBehavior — composite signals (behavior + fingerprint)', () => {
  it('combines multiple bot indicators', () => {
    const result = scoreBehavior({
      mouseMovements: 2,
      mouseVarianceX: 1,
      mouseVarianceY: 1,
      clickCount: 4,
      avgClickIntervalMs: 40,
      clickIntervalStddev: 3,
      keyPressCount: 0,
      timeOnPageMs: 800,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    expect(result.level).toBe('bot');
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('rushed checkout pushes human into suspicious range', () => {
    const result = scoreBehavior(baseHuman({
      timeOnPageMs: 600, // rushed
    }));
    // rushed_checkout +30 → score=30, level=suspicious (threshold 30)
    expect(result.reasons.some(r => r.includes('rushed_checkout'))).toBe(true);
    expect(result.score).toBe(30);
    expect(result.level).toBe('suspicious');
  });

  it('normal behavior with minor flags stays low score', () => {
    const result = scoreBehavior({
      mouseMovements: 100,
      mouseVarianceX: 10,
      mouseVarianceY: 12,
      clickCount: 3,
      avgClickIntervalMs: 800,
      clickIntervalStddev: 350,
      keyPressCount: 1,
      timeOnPageMs: 1500,
      focusBlurCount: 1,
      hasTouchEvents: false,
    });
    // No triggers fire here: variance > 5, interval > 50ms, stddev > 10, time > 1000ms
    expect(result.score).toBe(0);
    expect(result.level).toBe('human');
  });
});

describe('scoreBehavior — score capping at 100', () => {
  it('caps score at 100 even with extreme bot signals', () => {
    const result = scoreBehavior({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 100,
      avgClickIntervalMs: 5,
      clickIntervalStddev: 1,
      keyPressCount: 0,
      timeOnPageMs: 10,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.level).toBe('bot');
  });

  it('multiple flags push score into suspicious range', () => {
    const almostBot = scoreBehavior({
      mouseMovements: 50,
      mouseVarianceX: 8,
      mouseVarianceY: 7,
      clickCount: 2,
      avgClickIntervalMs: 100,
      clickIntervalStddev: 10,
      keyPressCount: 1,
      timeOnPageMs: 500,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    // timeOnPageMs < 1000 → rushed_checkout +30
    // variance avg = 7.5 > 5 → no low_mouse_variance
    // avgClickInterval = 100 > 50 → no clicks_too_fast
    // clickIntervalStddev = 10, not < 10 → no uniform_cadence
    expect(almostBot.score).toBe(30);
    expect(almostBot.level).toBe('suspicious');
  });
});

describe('scoreBehavior — no_interaction_signals', () => {
  it('adds small penalty for long session with zero interaction', () => {
    const result = scoreBehavior({
      mouseMovements: 50,
      mouseVarianceX: 20,
      mouseVarianceY: 20,
      clickCount: 0,
      avgClickIntervalMs: 0,
      clickIntervalStddev: 0,
      keyPressCount: 0,
      timeOnPageMs: 10_000,
      focusBlurCount: 0,
      hasTouchEvents: false,
    });
    expect(result.reasons.some(r => r.includes('no_interaction_signals'))).toBe(true);
    expect(result.score).toBe(5);
  });

  it('does not penalize when touch events present', () => {
    const result = scoreBehavior({
      mouseMovements: 0,
      mouseVarianceX: 0,
      mouseVarianceY: 0,
      clickCount: 0,
      avgClickIntervalMs: 0,
      clickIntervalStddev: 0,
      keyPressCount: 0,
      timeOnPageMs: 10_000,
      focusBlurCount: 0,
      hasTouchEvents: true,
    });
    expect(result.reasons.every(r => !r.includes('no_interaction_signals'))).toBe(true);
  });
});
