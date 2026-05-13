import { describe, it, expect } from 'vitest';
import { isGsm7, gsm7Length, countSegments, isWithinLimit, needsUnicode } from './segmenter.js';

describe('isGsm7', () => {
  it('returns true for basic ASCII text', () => {
    expect(isGsm7('Hello World')).toBe(true);
  });

  it('returns true for GSM-7 special chars', () => {
    expect(isGsm7('@£$¥èéùì')).toBe(true);
  });

  it('returns true for GSM-7 extension chars', () => {
    expect(isGsm7('^{}[]~|\\€')).toBe(true);
  });

  it('returns false for Czech diacritics', () => {
    expect(isGsm7('Příliš žluťoučký kůň')).toBe(false);
  });

  it('returns false for emoji', () => {
    expect(isGsm7('Hello 😀')).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isGsm7('')).toBe(true);
  });
});

describe('gsm7Length', () => {
  it('counts basic chars as 1', () => {
    expect(gsm7Length('Hello')).toBe(5);
  });

  it('counts extension chars as 2', () => {
    expect(gsm7Length('€')).toBe(2);
    expect(gsm7Length('^{}\\[~]|€')).toBe(18); // 9 chars × 2
  });

  it('mixes basic and extension', () => {
    expect(gsm7Length('Price: 10€')).toBe(11); // 9 basic + 1 ext (2)
  });

  it('returns 0 for empty string', () => {
    expect(gsm7Length('')).toBe(0);
  });
});

describe('countSegments', () => {
  it('returns 0 for empty text', () => {
    expect(countSegments('')).toBe(0);
  });

  it('returns 1 for short GSM-7 text', () => {
    expect(countSegments('Hello')).toBe(1);
  });

  it('returns 1 for exactly 160 GSM-7 chars', () => {
    expect(countSegments('a'.repeat(160))).toBe(1);
  });

  it('returns 2 for 161 GSM-7 chars', () => {
    expect(countSegments('a'.repeat(161))).toBe(2); // ceil(161/153) = 2
  });

  it('returns 2 for 306 GSM-7 chars', () => {
    expect(countSegments('a'.repeat(306))).toBe(2); // ceil(306/153) = 2
  });

  it('returns 3 for 307 GSM-7 chars', () => {
    expect(countSegments('a'.repeat(307))).toBe(3); // ceil(307/153) = 3
  });

  it('accounts for extension chars taking 2 positions', () => {
    // 159 basic + 1 euro (2) = 161 GSM-7 length → 2 segments
    expect(countSegments('a'.repeat(159) + '€')).toBe(2);
  });

  it('returns 1 for short Unicode text', () => {
    expect(countSegments('Ahoj 😀')).toBe(1);
  });

  it('returns 1 for exactly 70 Unicode code points', () => {
    expect(countSegments('č'.repeat(70))).toBe(1);
  });

  it('returns 2 for 71 Unicode code points', () => {
    expect(countSegments('č'.repeat(71))).toBe(2); // ceil(71/67) = 2
  });

  it('returns 2 for 134 Unicode code points', () => {
    expect(countSegments('č'.repeat(134))).toBe(2); // ceil(134/67) = 2
  });

  it('returns 3 for 135 Unicode code points', () => {
    expect(countSegments('č'.repeat(135))).toBe(3); // ceil(135/67) = 3
  });

  it('handles emoji (multi-byte code points) correctly', () => {
    // 69 chars + 1 emoji = 70 code points → 1 segment
    expect(countSegments('č'.repeat(69) + '😀')).toBe(1);
  });
});

describe('isWithinLimit', () => {
  it('returns true when within default limit of 10', () => {
    expect(isWithinLimit('Hello')).toBe(true);
  });

  it('returns true at exactly the limit', () => {
    // 10 GSM-7 segments = 1530 chars max (ceil(1530/153) = 10)
    expect(isWithinLimit('a'.repeat(1530))).toBe(true);
  });

  it('returns false when over the limit', () => {
    expect(isWithinLimit('a'.repeat(1531))).toBe(false);
  });

  it('respects custom limit', () => {
    // 161 chars = 2 segments
    expect(isWithinLimit('a'.repeat(161), 1)).toBe(false);
    expect(isWithinLimit('a'.repeat(161), 2)).toBe(true);
  });
});

describe('needsUnicode', () => {
  it('returns false for GSM-7 text', () => {
    expect(needsUnicode('Hello World!')).toBe(false);
  });

  it('returns true for Czech text', () => {
    expect(needsUnicode('Příliš')).toBe(true);
  });

  it('returns true for emoji', () => {
    expect(needsUnicode('😀')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(needsUnicode('')).toBe(false);
  });
});
