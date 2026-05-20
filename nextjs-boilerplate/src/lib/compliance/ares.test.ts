import { describe, expect, it, vi, beforeEach } from 'vitest';
import { checkAres, computeInitialRiskScore } from './ares';

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
});

describe('checkAres', () => {
  it('odmítne invalid format (non-digit)', async () => {
    const r = await checkAres('abc12345');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_FORMAT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('odmítne invalid format (too long)', async () => {
    const r = await checkAres('123456789'); // 9 digits
    expect(r.valid).toBe(false);
    expect(r.error).toBe('INVALID_FORMAT');
  });

  it('padding na 8 znaků', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ obchodniJmeno: 'X' }), { status: 200 }));
    await checkAres('12345');
    expect(fetchMock.mock.calls[0][0]).toContain('/00012345');
  });

  it('404 z ARES → not found', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    const r = await checkAres('12345678');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('NOT_FOUND');
  });

  it('aktivní firma → valid + active', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          obchodniJmeno: 'Tixly s.r.o.',
          datumZaniku: null,
          datumVzniku: '2020-01-15',
          dic: 'CZ12345678',
          sidlo: { textovaAdresa: 'Václavské náměstí 1, 110 00 Praha' },
        }),
        { status: 200 },
      ),
    );
    const r = await checkAres('12345678');
    expect(r.valid).toBe(true);
    expect(r.active).toBe(true);
    expect(r.legalName).toBe('Tixly s.r.o.');
    expect(r.dic).toBe('CZ12345678');
  });

  it('zaniklý subjekt → valid ale not active', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          obchodniJmeno: 'Zaniklá s.r.o.',
          datumZaniku: '2024-12-31',
          datumVzniku: '2018-01-01',
        }),
        { status: 200 },
      ),
    );
    const r = await checkAres('99999999');
    expect(r.valid).toBe(true);
    expect(r.active).toBe(false);
    expect(r.dissolvedAt).toBe('2024-12-31');
  });

  it('timeout → graceful', async () => {
    fetchMock.mockImplementationOnce(() => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    const r = await checkAres('12345678');
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });
});

describe('computeInitialRiskScore', () => {
  it('valid + active + DIČ + 3+ years → low score', () => {
    const score = computeInitialRiskScore({
      valid: true, active: true, dic: 'CZ12345678',
      registeredAt: '2020-01-01',
    });
    expect(score).toBeLessThanOrEqual(50);
  });

  it('nově založená firma (< 30 dní) → high score', () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 15);
    const score = computeInitialRiskScore({
      valid: true, active: true,
      registeredAt: recent.toISOString(),
    });
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('zaniklý subjekt → max 100', () => {
    const score = computeInitialRiskScore({
      valid: true, active: false,
    });
    expect(score).toBe(100);
  });

  it('IČO not found → +50 baseline', () => {
    const score = computeInitialRiskScore({
      valid: false, active: false, error: 'NOT_FOUND',
    });
    expect(score).toBe(100);
  });
});
