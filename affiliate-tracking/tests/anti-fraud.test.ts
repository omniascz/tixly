import { describe, it, expect } from 'vitest';
import { evaluateFraud } from '../src/lib/anti-fraud.js';

const base = {
  buyerIp: '1.2.3.4',
  affiliateSignupIp: '9.9.9.9',
  lastClickAt: new Date('2026-04-08T10:00:00Z'),
  conversionAt: new Date('2026-04-08T10:10:00Z'),
  distinctAffiliatesFromIpRecent: 1,
};

describe('evaluateFraud()', () => {
  it('čistá konverze projde', () => {
    const r = evaluateFraud(base);
    expect(r.rejected).toBe(false);
    expect(r.flagged).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('self-purchase ze stejné IP → rejected', () => {
    const r = evaluateFraud({ ...base, buyerIp: '1.2.3.4', affiliateSignupIp: '1.2.3.4' });
    expect(r.rejected).toBe(true);
    expect(r.reasons).toContain('self_purchase_same_ip');
  });

  it('click-to-conversion pod 5 s → rejected', () => {
    const r = evaluateFraud({
      ...base,
      lastClickAt: new Date('2026-04-08T10:00:00Z'),
      conversionAt: new Date('2026-04-08T10:00:02Z'),
    });
    expect(r.rejected).toBe(true);
    expect(r.reasons).toContain('click_to_conversion_too_fast');
  });

  it('click-to-conversion přesně 5 s → projde', () => {
    const r = evaluateFraud({
      ...base,
      lastClickAt: new Date('2026-04-08T10:00:00Z'),
      conversionAt: new Date('2026-04-08T10:00:05Z'),
    });
    expect(r.rejected).toBe(false);
  });

  it('IP fanout ≥ 3 různých affiliatů → flagged', () => {
    const r = evaluateFraud({ ...base, distinctAffiliatesFromIpRecent: 3 });
    expect(r.rejected).toBe(false);
    expect(r.flagged).toBe(true);
    expect(r.reasons).toContain('ip_affiliate_fanout');
  });
});
