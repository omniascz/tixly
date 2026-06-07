import { describe, it, expect } from 'vitest';
import { signPrintToken, verifyPrintToken, looksLikePrintToken } from './print-token';

const TICKET_ID = '8a4f7b2e-1c2d-4e5f-9a0b-1c2d3e4f5a6b';

describe('print-token', () => {
  it('round-trips a ticket UUID', () => {
    const token = signPrintToken(TICKET_ID);
    expect(token.startsWith('TXP1.')).toBe(true);
    expect(token.length).toBeLessThanOrEqual(45); // QR zůstává řídký
    const v = verifyPrintToken(token);
    expect(v.ok).toBe(true);
    expect(v.ticketId).toBe(TICKET_ID);
  });

  it('looksLikePrintToken detekuje schéma', () => {
    expect(looksLikePrintToken(signPrintToken(TICKET_ID))).toBe(true);
    expect(looksLikePrintToken(TICKET_ID)).toBe(false);
    expect(looksLikePrintToken('tixly:' + TICKET_ID + ':123456')).toBe(false);
  });

  it('odmítne podpis po manipulaci s jedním znakem', () => {
    const token = signPrintToken(TICKET_ID);
    // překlopit poslední znak base64url
    const last = token.slice(-1);
    const swapped = last === 'A' ? 'B' : 'A';
    const tampered = token.slice(0, -1) + swapped;
    const v = verifyPrintToken(tampered);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('invalid_signature');
  });

  it('odmítne nesmysl / cizí schéma', () => {
    expect(verifyPrintToken('hello').ok).toBe(false);
    expect(verifyPrintToken('TXP1.short').ok).toBe(false);
    expect(verifyPrintToken(TICKET_ID).ok).toBe(false);
  });

  it('signPrintToken vyžaduje UUID', () => {
    expect(() => signPrintToken('not-a-uuid')).toThrow();
  });
});
