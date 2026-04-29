/**
 * Vitest tests — Mailgun webhook signature & timestamp verification
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { verifyMailgunSignature, isTimestampFresh } from './mailgun-verify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_KEY = 'test-webhook-signing-key';

function buildValidSignature(timestamp: string, token: string, key: string): string {
  return createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// verifyMailgunSignature
// ---------------------------------------------------------------------------

describe('verifyMailgunSignature', () => {
  it('returns true for a valid signature', () => {
    const timestamp = '1680000000';
    const token     = 'abc123randomtoken';
    const signature = buildValidSignature(timestamp, token, WEBHOOK_KEY);

    expect(verifyMailgunSignature(timestamp, token, signature, WEBHOOK_KEY)).toBe(true);
  });

  it('returns false when signature is tampered', () => {
    const timestamp = '1680000000';
    const token     = 'abc123randomtoken';
    const badSig    = buildValidSignature(timestamp, token, WEBHOOK_KEY).slice(0, -2) + 'ff';

    expect(verifyMailgunSignature(timestamp, token, badSig, WEBHOOK_KEY)).toBe(false);
  });

  it('returns false when the wrong webhook key is used', () => {
    const timestamp = '1680000000';
    const token     = 'abc123randomtoken';
    const signature = buildValidSignature(timestamp, token, 'wrong-key');

    expect(verifyMailgunSignature(timestamp, token, signature, WEBHOOK_KEY)).toBe(false);
  });

  it('returns false when timestamp is empty', () => {
    const token     = 'sometoken';
    const signature = buildValidSignature('1680000000', token, WEBHOOK_KEY);
    expect(verifyMailgunSignature('', token, signature, WEBHOOK_KEY)).toBe(false);
  });

  it('returns false when token is empty', () => {
    const timestamp = '1680000000';
    const signature = buildValidSignature(timestamp, 'sometoken', WEBHOOK_KEY);
    expect(verifyMailgunSignature(timestamp, '', signature, WEBHOOK_KEY)).toBe(false);
  });

  it('returns false when signature is empty', () => {
    const timestamp = '1680000000';
    const token     = 'abc123randomtoken';
    expect(verifyMailgunSignature(timestamp, token, '', WEBHOOK_KEY)).toBe(false);
  });

  it('returns false when webhookKey is empty', () => {
    const timestamp = '1680000000';
    const token     = 'abc123randomtoken';
    const signature = buildValidSignature(timestamp, token, WEBHOOK_KEY);
    expect(verifyMailgunSignature(timestamp, token, signature, '')).toBe(false);
  });

  it('is not vulnerable to length-extension (different token → different result)', () => {
    const timestamp  = '1680000000';
    const token1     = 'token-one';
    const token2     = 'token-two';
    const signature1 = buildValidSignature(timestamp, token1, WEBHOOK_KEY);

    expect(verifyMailgunSignature(timestamp, token2, signature1, WEBHOOK_KEY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTimestampFresh
// ---------------------------------------------------------------------------

describe('isTimestampFresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when timestamp is exactly now', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isTimestampFresh(String(now), 900)).toBe(true);
  });

  it('returns true when timestamp is within maxAgeSeconds', () => {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    expect(isTimestampFresh(String(fiveMinutesAgo), 900)).toBe(true);
  });

  it('returns false when timestamp is older than maxAgeSeconds', () => {
    const sixteenMinutesAgo = Math.floor(Date.now() / 1000) - 960;
    expect(isTimestampFresh(String(sixteenMinutesAgo), 900)).toBe(false);
  });

  it('returns false when timestamp is 0', () => {
    expect(isTimestampFresh('0', 900)).toBe(false);
  });

  it('returns false for a non-numeric timestamp', () => {
    expect(isTimestampFresh('not-a-number', 900)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isTimestampFresh('', 900)).toBe(false);
  });

  it('returns false for a timestamp far in the future (> 60 s)', () => {
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    expect(isTimestampFresh(String(farFuture), 900)).toBe(false);
  });

  it('returns true for a timestamp up to 60 seconds in the future (clock skew tolerance)', () => {
    const slightlyAhead = Math.floor(Date.now() / 1000) + 55;
    expect(isTimestampFresh(String(slightlyAhead), 900)).toBe(true);
  });
});
