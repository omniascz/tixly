import { describe, it, expect, vi } from 'vitest';
import {
  eventShortId,
  generateVariableSymbol,
  parseVariableSymbol,
} from '../vs-generator';

describe('eventShortId', () => {
  it('vrací 6-digit deterministicky pro stejné UUID', () => {
    const id = '12345678-0000-4000-a000-000000000001';
    const a = eventShortId(id);
    const b = eventShortId(id);
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{6}$/);
  });

  it('padduje vodicími nulami pro malé hex', () => {
    const id = '00000001-0000-4000-a000-000000000001';
    // 0x00000001 % 1_000_000 = 1 → '000001'
    expect(eventShortId(id)).toBe('000001');
  });

  it('různé UUID → různé short ID', () => {
    const a = eventShortId('aaaaaaaa-0000-0000-0000-000000000000');
    const b = eventShortId('bbbbbbbb-0000-0000-0000-000000000000');
    expect(a).not.toBe(b);
  });
});

describe('generateVariableSymbol', () => {
  function mockDb(orderCount: number) {
    return {
      query: vi.fn().mockResolvedValue({
        rows: [{ next_seq: String(orderCount + 1) }],
      }),
    };
  }

  it('vrátí 10-digit VS pro standardní akci (< 9999 lístků)', async () => {
    const db = mockDb(22);
    const vs = await generateVariableSymbol('00000123-0000-4000-a000-000000000001', db as never);
    expect(vs).toMatch(/^\d{10}$/);
    expect(vs.endsWith('0023')).toBe(true);
    expect(vs.length).toBe(10);
  });

  it('první lístek v akci dostane sequence 0001', async () => {
    const db = mockDb(0);
    const vs = await generateVariableSymbol('00000123-0000-4000-a000-000000000001', db as never);
    expect(vs.endsWith('0001')).toBe(true);
  });

  it('festival fallback při >9999 lístcích', async () => {
    const db = mockDb(15000);
    const vs = await generateVariableSymbol('aabbccdd-0000-4000-a000-000000000001', db as never);
    expect(vs).toMatch(/^\d{10}$/);
    expect(vs.endsWith('15001')).toBe(true);
  });

  it('throws na overflow > 999 999', async () => {
    const db = mockDb(1_000_000);
    await expect(
      generateVariableSymbol('aabbccdd-0000-4000-a000-000000000001', db as never),
    ).rejects.toThrow(/overflow/);
  });
});

describe('parseVariableSymbol', () => {
  it('parsuje standard formát', () => {
    const candidates = parseVariableSymbol('4012340023');
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toEqual({ eventShortId: '401234', sequence: 23 });
    expect(candidates[1]).toEqual({ eventShortId: '40123', sequence: 40023 });
    expect(candidates[2]).toEqual({ eventShortId: '4012', sequence: 340023 });
  });

  it('odmítá ne-10-digit input', () => {
    expect(parseVariableSymbol('123')).toEqual([]);
    expect(parseVariableSymbol('abc1234567')).toEqual([]);
    expect(parseVariableSymbol('12345678901')).toEqual([]);
  });
});
