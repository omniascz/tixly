import { describe, it, expect } from 'vitest';
import {
  issueOfferToken,
  hashOfferToken,
  offerTokenMatches,
  checkOfferAccess,
  canRespond,
} from './offer-token';

const NOW = new Date('2026-08-14T12:00:00Z');

describe('issueOfferToken', () => {
  it('vydá token i jeho otisk a platnost', () => {
    const t = issueOfferToken(14, NOW);
    expect(t.token.length).toBeGreaterThan(30);
    expect(t.hash).toHaveLength(64);
    expect(t.expiresAt.toISOString()).toBe('2026-08-28T12:00:00.000Z');
  });

  it('dva tokeny nejsou nikdy stejné', () => {
    const a = issueOfferToken(14, NOW);
    const b = issueOfferToken(14, NOW);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it('otisk odpovídá tokenu', () => {
    const t = issueOfferToken(14, NOW);
    expect(hashOfferToken(t.token)).toBe(t.hash);
  });
});

describe('offerTokenMatches', () => {
  it('správný token se shoduje', () => {
    const t = issueOfferToken(14, NOW);
    expect(offerTokenMatches(t.token, t.hash)).toBe(true);
  });

  it('cizí token se neshoduje', () => {
    const t = issueOfferToken(14, NOW);
    const other = issueOfferToken(14, NOW);
    expect(offerTokenMatches(other.token, t.hash)).toBe(false);
  });

  it('bez uloženého otisku se neshoduje nic', () => {
    expect(offerTokenMatches('cokoli', null)).toBe(false);
  });
});

describe('checkOfferAccess', () => {
  it('platný token otevře nabídku', () => {
    expect(
      checkOfferAccess({
        matches: true,
        tokenExpiresAt: new Date('2026-08-20T00:00:00Z'),
        status: 'sent',
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('propadlý odkaz neukáže nic', () => {
    expect(
      checkOfferAccess({
        matches: true,
        tokenExpiresAt: new Date('2026-08-01T00:00:00Z'),
        status: 'sent',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('špatný token vypadá stejně jako neexistující nabídka', () => {
    expect(
      checkOfferAccess({ matches: false, tokenExpiresAt: null, status: 'sent', now: NOW }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('přijatá nabídka zůstává čitelná — agent má právo vidět, co podepsal', () => {
    expect(
      checkOfferAccess({ matches: true, tokenExpiresAt: null, status: 'accepted', now: NOW }),
    ).toEqual({ ok: true });
  });

  it('stažená nabídka se neukazuje', () => {
    expect(
      checkOfferAccess({ matches: true, tokenExpiresAt: null, status: 'withdrawn', now: NOW }),
    ).toEqual({ ok: false, reason: 'closed' });
  });
});

describe('canRespond', () => {
  it('na odeslanou nabídku jde odpovědět', () => {
    expect(canRespond('sent', null, NOW)).toBe(true);
  });

  it('na protinávrh taky — jednání pokračuje', () => {
    expect(canRespond('countered', null, NOW)).toBe(true);
  });

  it('po vypršení platnosti nabídky už ne', () => {
    expect(canRespond('sent', new Date('2026-08-01T00:00:00Z'), NOW)).toBe(false);
  });

  it('na přijatou ani odmítnutou se neodpovídá', () => {
    expect(canRespond('accepted', null, NOW)).toBe(false);
    expect(canRespond('declined', null, NOW)).toBe(false);
  });

  it('koncept agent nevidí a neodpovídá na něj', () => {
    expect(canRespond('draft', null, NOW)).toBe(false);
  });
});
