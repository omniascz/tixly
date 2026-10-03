import { describe, expect, it } from 'vitest';
import { qrPolicyDecision } from './qr-policy';

const now = Date.parse('2026-10-04T12:00:00Z');
const inHours = (h: number) => new Date(now + h * 3600_000).toISOString();

describe('qrPolicyDecision (kolo 5 — sdílené validate + passage)', () => {
  it('rotating_24h: víc než 24 h před akcí TOTP nepotřebuje, do 24 h ano', () => {
    expect(qrPolicyDecision({ qrPolicy: 'rotating_24h', eventDateStart: inHours(48), printVerifiedForEvent: false, now }).totpRequired).toBe(false);
    expect(qrPolicyDecision({ qrPolicy: 'rotating_24h', eventDateStart: inHours(1), printVerifiedForEvent: false, now }).totpRequired).toBe(true);
  });
  it('chybějící politika = rotating_24h (výchozí z kola 2)', () => {
    expect(qrPolicyDecision({ qrPolicy: null, eventDateStart: inHours(1), printVerifiedForEvent: false, now }).totpRequired).toBe(true);
  });
  it('TXP2 nahradí TOTP u static_allowed a rotating_24h, u rotating_only / photo_required ne', () => {
    expect(qrPolicyDecision({ qrPolicy: 'rotating_24h', eventDateStart: inHours(1), printVerifiedForEvent: true, now }).totpRequired).toBe(false);
    expect(qrPolicyDecision({ qrPolicy: 'rotating_only', eventDateStart: inHours(48), printVerifiedForEvent: true, now }).totpRequired).toBe(true);
    expect(qrPolicyDecision({ qrPolicy: 'photo_required', eventDateStart: inHours(48), printVerifiedForEvent: true, now }).totpRequired).toBe(true);
  });
  it('static_allowed nikdy nevyžaduje TOTP', () => {
    expect(qrPolicyDecision({ qrPolicy: 'static_allowed', eventDateStart: inHours(0), printVerifiedForEvent: false, now }).totpRequired).toBe(false);
  });
});
