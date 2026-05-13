import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  signPayload,
  verifySignature,
  signPayloadWithTimestamp,
  verifyTimestampedSignature,
  generateWebhookSecret,
} from './signing.js';

// ---------------------------------------------------------------------------
// signPayload
// ---------------------------------------------------------------------------

describe('signPayload', () => {
  it('returns sha256= prefixed hex string', () => {
    const sig = signPayload('secret', 'payload');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const a = signPayload('key', 'data');
    const b = signPayload('key', 'data');
    expect(a).toBe(b);
  });

  it('matches manual HMAC-SHA256 computation', () => {
    const secret = 'my-webhook-secret';
    const payload = '{"event":"invoice.created"}';
    const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    expect(signPayload(secret, payload)).toBe(expected);
  });

  it('different secrets produce different signatures', () => {
    const payload = 'same-payload';
    expect(signPayload('secret-a', payload)).not.toBe(signPayload('secret-b', payload));
  });

  it('different payloads produce different signatures', () => {
    const secret = 'same-secret';
    expect(signPayload(secret, 'payload-a')).not.toBe(signPayload(secret, 'payload-b'));
  });

  it('handles empty payload', () => {
    const sig = signPayload('secret', '');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('handles unicode payload', () => {
    const sig = signPayload('secret', '{"name":"Příliš žluťoučký kůň"}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------

describe('verifySignature', () => {
  it('returns true for valid signature', () => {
    const secret = 'test-secret';
    const payload = '{"event":"order.paid"}';
    const sig = signPayload(secret, payload);
    expect(verifySignature(secret, payload, sig)).toBe(true);
  });

  it('returns false for tampered payload', () => {
    const secret = 'secret';
    const sig = signPayload(secret, 'original');
    expect(verifySignature(secret, 'tampered', sig)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const payload = 'payload';
    const sig = signPayload('right-secret', payload);
    expect(verifySignature('wrong-secret', payload, sig)).toBe(false);
  });

  it('returns false for length mismatch', () => {
    expect(verifySignature('s', 'p', 'sha256=short')).toBe(false);
  });

  it('returns false for empty signature', () => {
    expect(verifySignature('s', 'p', '')).toBe(false);
  });

  it('returns false for garbage input', () => {
    expect(verifySignature('s', 'p', 'not-a-signature')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// signPayloadWithTimestamp
// ---------------------------------------------------------------------------

describe('signPayloadWithTimestamp', () => {
  it('returns t=<unix>,v1=<hex> format', () => {
    const result = signPayloadWithTimestamp('secret', 'payload', 1700000000);
    expect(result).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it('signs "<timestamp>.<payload>" string', () => {
    const secret = 'my-secret';
    const payload = '{"data":true}';
    const ts = 1700000000;
    const expected = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    const result = signPayloadWithTimestamp(secret, payload, ts);
    expect(result).toBe(`t=${ts},v1=${expected}`);
  });

  it('different timestamps produce different signatures', () => {
    const a = signPayloadWithTimestamp('s', 'p', 1000);
    const b = signPayloadWithTimestamp('s', 'p', 2000);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// verifyTimestampedSignature
// ---------------------------------------------------------------------------

describe('verifyTimestampedSignature', () => {
  it('returns true for valid recent signature', () => {
    const secret = 'test-secret';
    const payload = '{"event":"test"}';
    const ts = Math.floor(Date.now() / 1000);
    const header = signPayloadWithTimestamp(secret, payload, ts);
    expect(verifyTimestampedSignature(secret, payload, header)).toBe(true);
  });

  it('returns false for expired signature (beyond tolerance)', () => {
    const secret = 'secret';
    const payload = 'payload';
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const header = signPayloadWithTimestamp(secret, payload, oldTs);
    expect(verifyTimestampedSignature(secret, payload, header, 300)).toBe(false);
  });

  it('returns true within custom tolerance', () => {
    const secret = 'secret';
    const payload = 'payload';
    const ts = Math.floor(Date.now() / 1000) - 60; // 1 min ago
    const header = signPayloadWithTimestamp(secret, payload, ts);
    expect(verifyTimestampedSignature(secret, payload, header, 120)).toBe(true);
  });

  it('returns false for malformed header', () => {
    expect(verifyTimestampedSignature('s', 'p', 'garbage')).toBe(false);
    expect(verifyTimestampedSignature('s', 'p', 't=abc,v1=def')).toBe(false);
    expect(verifyTimestampedSignature('s', 'p', '')).toBe(false);
  });

  it('returns false for tampered payload', () => {
    const secret = 'secret';
    const ts = Math.floor(Date.now() / 1000);
    const header = signPayloadWithTimestamp(secret, 'original', ts);
    expect(verifyTimestampedSignature(secret, 'tampered', header)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateWebhookSecret
// ---------------------------------------------------------------------------

describe('generateWebhookSecret', () => {
  it('returns 64-char hex string (32 random bytes)', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).toHaveLength(64);
  });

  it('generates unique secrets', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateWebhookSecret()));
    expect(secrets.size).toBe(20);
  });
});
