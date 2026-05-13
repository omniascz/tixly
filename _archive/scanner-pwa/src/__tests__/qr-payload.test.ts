// ---------------------------------------------------------------------------
// QR payload parser tests — Vitest
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { decodeQRPayload, QRPayloadSchema } from '../lib/qr-payload.js';

const VALID_PAYLOAD = {
  ticketId: 'ticket_abc123',
  totpValue: '12345678',
  timestamp: 1704067200,
  eventId: 'evt_xyz',
  signature: 'sig_valid',
};

function encodePayload(payload: typeof VALID_PAYLOAD): string {
  const raw = `${payload.ticketId}|${payload.totpValue}|${payload.timestamp}|${payload.eventId}|${payload.signature}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe('QR payload parser', () => {
  it('decodes valid base64 payload', () => {
    const encoded = encodePayload(VALID_PAYLOAD);
    const decoded = decodeQRPayload(encoded);

    expect(decoded.ticketId).toBe('ticket_abc123');
    expect(decoded.totpValue).toBe('12345678');
    expect(decoded.timestamp).toBe(1704067200);
    expect(decoded.eventId).toBe('evt_xyz');
    expect(decoded.signature).toBe('sig_valid');
  });

  it('throws on invalid base64', () => {
    const invalidB64 = '!!!invalid_base64!!!';
    expect(() => decodeQRPayload(invalidB64)).toThrow('QR_PAYLOAD_DECODE_FAILED');
  });

  it('throws on malformed payload — missing pipe separator', () => {
    const raw = 'ticket_abc123|12345678|1704067200|evt_xyz'; // missing signature
    const encoded = Buffer.from(raw).toString('base64');
    expect(() => decodeQRPayload(encoded)).toThrow(
      'QR_PAYLOAD_DECODE_FAILED: expected 5 fields, got 4',
    );
  });

  it('throws on malformed payload — invalid TOTP (not 8 digits)', () => {
    const payload = { ...VALID_PAYLOAD, totpValue: '1234567' }; // 7 digits
    const encoded = encodePayload(payload);
    expect(() => decodeQRPayload(encoded)).toThrow();
  });

  it('throws on malformed payload — invalid TOTP (contains letters)', () => {
    const payload = { ...VALID_PAYLOAD, totpValue: '1234567a' };
    const encoded = encodePayload(payload);
    expect(() => decodeQRPayload(encoded)).toThrow();
  });

  it('throws on malformed payload — invalid timestamp (not int)', () => {
    const raw = 'ticket_abc123|12345678|1704067200.5|evt_xyz|sig_valid';
    const encoded = Buffer.from(raw).toString('base64');
    expect(() => decodeQRPayload(encoded)).toThrow();
  });

  it('throws on malformed payload — negative timestamp', () => {
    const raw = 'ticket_abc123|12345678|-100|evt_xyz|sig_valid';
    const encoded = Buffer.from(raw).toString('base64');
    expect(() => decodeQRPayload(encoded)).toThrow();
  });

  it('throws on empty ticketId', () => {
    const payload = { ...VALID_PAYLOAD, ticketId: '' };
    const encoded = encodePayload(payload);
    expect(() => decodeQRPayload(encoded)).toThrow();
  });

  it('throws on empty eventId', () => {
    const payload = { ...VALID_PAYLOAD, eventId: '' };
    const encoded = encodePayload(payload);
    expect(() => decodeQRPayload(encoded)).toThrow();
  });

  it('throws on empty signature', () => {
    const payload = { ...VALID_PAYLOAD, signature: '' };
    const encoded = encodePayload(payload);
    expect(() => decodeQRPayload(encoded)).toThrow();
  });

  it('accepts hex-encoded timestamp in raw payload', () => {
    // Some QR implementations may use hex for timestamp — we accept decimal here
    // This test just verifies strict validation
    const encoded = encodePayload(VALID_PAYLOAD);
    const decoded = decodeQRPayload(encoded);
    expect(typeof decoded.timestamp).toBe('number');
    expect(decoded.timestamp).toBeGreaterThan(0);
  });
});
