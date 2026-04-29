import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAccessToken, verifyAccessToken, markTokenUsed, validateAccessToken } from '../src/lib/access-token';
import { AccessLinkExpiredError, AccessLinkAlreadyUsedError } from '../src/types/verified-fan.types';

const SECRET = 'test-secret-at-least-32-chars-long!!';

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
});

const PAYLOAD = {
  registrationId: 'reg_abc',
  eventId: 'evt_001',
  userId: 'user_1',
  presaleTicketTypeId: 'tt_presale',
};

describe('generateAccessToken()', () => {
  it('vygeneruje token s expirací', async () => {
    const { token, expiresAt } = await generateAccessToken(PAYLOAD, 48);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('expiresAt odpovídá zadaným hodinám', async () => {
    const before = Date.now();
    const { expiresAt } = await generateAccessToken(PAYLOAD, 24);
    const after = Date.now();

    const expectedMs = 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs + 1000);
  });
});

describe('verifyAccessToken()', () => {
  it('ověří platný token a vrátí payload', async () => {
    const { token } = await generateAccessToken(PAYLOAD, 48);
    const decoded = await verifyAccessToken(token);

    expect(decoded.registrationId).toBe(PAYLOAD.registrationId);
    expect(decoded.eventId).toBe(PAYLOAD.eventId);
    expect(decoded.userId).toBe(PAYLOAD.userId);
    expect(decoded.presaleTicketTypeId).toBe(PAYLOAD.presaleTicketTypeId);
  });

  it('vyhodí AccessLinkExpiredError pro neplatný token', async () => {
    await expect(verifyAccessToken('invalid.jwt.token'))
      .rejects.toThrow(AccessLinkExpiredError);
  });

  it('vyhodí AccessLinkExpiredError pro token s jiným secret', async () => {
    process.env.JWT_SECRET = 'original-secret-at-least-32-chars-ok';
    const { token } = await generateAccessToken(PAYLOAD, 48);

    process.env.JWT_SECRET = 'different-secret-at-least-32-chars!';
    await expect(verifyAccessToken(token))
      .rejects.toThrow(AccessLinkExpiredError);
  });
});

describe('markTokenUsed()', () => {
  it('vrátí true při prvním použití', async () => {
    const redis = { setNx: vi.fn().mockResolvedValue(true) };
    const result = await markTokenUsed('reg_1', redis);
    expect(result).toBe(true);
    expect(redis.setNx).toHaveBeenCalledWith(
      'tixly:verified-fan:used:reg_1',
      '1',
      expect.any(Number),
    );
  });

  it('vyhodí AccessLinkAlreadyUsedError při druhém použití', async () => {
    const redis = { setNx: vi.fn().mockResolvedValue(false) };
    await expect(markTokenUsed('reg_1', redis))
      .rejects.toThrow(AccessLinkAlreadyUsedError);
  });
});

describe('validateAccessToken()', () => {
  it('returns valid=true for a fresh token matching the event', async () => {
    const { token } = await generateAccessToken(PAYLOAD, 48);
    const result = await validateAccessToken(token, PAYLOAD.eventId);
    expect(result.valid).toBe(true);
    expect(result.fanId).toBe(PAYLOAD.userId);
  });

  it('returns event_mismatch when eventId differs', async () => {
    const { token } = await generateAccessToken(PAYLOAD, 48);
    const result = await validateAccessToken(token, 'evt_wrong');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('event_mismatch');
  });

  it('returns already_used when redis has the used key', async () => {
    const { token } = await generateAccessToken(PAYLOAD, 48);
    const redis = {
      setNx: vi.fn().mockResolvedValue(true),
      get: vi.fn().mockResolvedValue('1'),
    };
    const result = await validateAccessToken(token, PAYLOAD.eventId, redis);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('already_used');
  });

  it('returns invalid for garbage tokens', async () => {
    const result = await validateAccessToken('not-a-jwt', 'evt_001');
    expect(result.valid).toBe(false);
  });
});
