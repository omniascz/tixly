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

describe('TXP2 — tiskový token vázaný na vstupenku i akci (kolo 4)', () => {
  const T = '0b8f8f7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
  const E = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const E2 = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

  it('podepsaný token projde ověřením pro svou akci', async () => {
    const m = await import('./print-token');
    const tok = m.signEventPrintToken(T, E);
    expect(tok).toMatch(/^TXP2\./);
    expect(m.parsePrintToken(tok)).toEqual({ scheme: 'TXP2', ticketId: T });
    expect(m.verifyPrintTokenForEvent(tok, E)).toMatchObject({ ok: true, ticketId: T, scheme: 'TXP2' });
  });

  it('pro jinou akci neprojde (vazba na akci)', async () => {
    const m = await import('./print-token');
    expect(m.verifyPrintTokenForEvent(m.signEventPrintToken(T, E), E2).ok).toBe(false);
  });

  it('změněný podpis i zkrácený token neprojdou', async () => {
    const m = await import('./print-token');
    const tok = m.signEventPrintToken(T, E);
    const tampered = tok.slice(0, -2) + (tok.endsWith('AA') ? 'BB' : 'AA');
    expect(m.verifyPrintTokenForEvent(tampered, E).ok).toBe(false);
    expect(m.parsePrintToken(tok.slice(0, -6))).toBeNull();
  });

  it('TXP1 se ověřuje jako dřív (akce se ignoruje) a klient pozná oba prefixy', async () => {
    const m = await import('./print-token');
    const t1 = m.signPrintToken(T);
    expect(m.verifyPrintTokenForEvent(t1, E2)).toMatchObject({ ok: true, scheme: 'TXP1' });
    expect(m.looksLikeAnyPrintToken(t1)).toBe(true);
    expect(m.looksLikeAnyPrintToken(m.signEventPrintToken(T, E))).toBe(true);
  });
});
