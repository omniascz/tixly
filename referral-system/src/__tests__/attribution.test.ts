import { describe, it, expect } from 'vitest';
import { getLastClickAttribution } from '../lib/attribution.js';
import type { ReferralClick } from '../types/referral.types.js';

// ============================================================
// attribution — last-click unit tests (__tests__ dir)
// ============================================================

function makeClick(
  id: number,
  occurredAt: Date,
  linkId = 'link-1',
): ReferralClick {
  return {
    id: BigInt(id),
    linkId,
    referrerCode: 'AbCd1234',
    visitorId: 'visitor-1',
    sessionId: 'sess-1',
    ipHash: 'iphash',
    userAgentHash: 'uahash',
    occurredAt,
    converted: false,
    convertedAt: null,
  };
}

describe('getLastClickAttribution', () => {
  const now = new Date('2026-04-08T12:00:00Z');

  it('returns null when there are no clicks', () => {
    expect(getLastClickAttribution([], now)).toBeNull();
  });

  it('returns the most recent click when multiple are present', () => {
    const clicks: ReferralClick[] = [
      makeClick(1, new Date('2026-04-01T10:00:00Z')),
      makeClick(2, new Date('2026-04-07T10:00:00Z')),
      makeClick(3, new Date('2026-04-05T10:00:00Z')),
    ];
    const result = getLastClickAttribution(clicks, now);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(2n);
  });

  it('returns the single click when only one exists', () => {
    const only = makeClick(42, new Date('2026-04-05T10:00:00Z'));
    const result = getLastClickAttribution([only], now);
    expect(result?.id).toBe(42n);
  });

  it('ignores clicks outside the 30-day conversion window', () => {
    const clicks: ReferralClick[] = [
      makeClick(1, new Date('2025-12-01T10:00:00Z')), // > 30 days ago
      makeClick(2, new Date('2026-04-01T10:00:00Z')),
    ];
    const result = getLastClickAttribution(clicks, now);
    expect(result?.id).toBe(2n);
  });
});
