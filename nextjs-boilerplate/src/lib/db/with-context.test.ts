import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn(async () => mockClient),
};

vi.mock('pg', () => ({
  Pool: vi.fn(() => mockPool),
}));

import {
  withPromoterDb,
  withAnonDb,
} from './with-context';

beforeEach(() => {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockClear();
});

describe('withPromoterDb', () => {
  it('odmítne invalid UUID', async () => {
    await expect(
      withPromoterDb('not-a-uuid', async () => 'X'),
    ).rejects.toThrow(/invalid promoterId/);
  });

  it('BEGIN + SET LOCAL + callback + COMMIT', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    const result = await withPromoterDb(
      '11111111-1111-1111-1111-111111111111',
      async (client) => {
        await client.query('SELECT 1');
        return 'ok';
      },
    );
    expect(result).toBe('ok');
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      "SET LOCAL app.current_promoter_id = '11111111-1111-1111-1111-111111111111'",
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(3, 'SELECT 1');
    expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('ROLLBACK + release při chybě v callback', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql.startsWith('SET LOCAL')) return { rows: [] };
      if (sql === 'BOOM') throw new Error('query failed');
      return { rows: [] };
    });
    await expect(
      withPromoterDb('11111111-1111-1111-1111-111111111111', async (client) => {
        await client.query('BOOM');
      }),
    ).rejects.toThrow(/query failed/);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('withAnonDb', () => {
  it('žádné session vars (jen acquire + release)', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    await withAnonDb(async (client) => {
      await client.query('SELECT * FROM events');
    });
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM events');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('release i při chybě', async () => {
    mockClient.query.mockRejectedValueOnce(new Error('boom'));
    await expect(
      withAnonDb(async (client) => {
        await client.query('BAD');
      }),
    ).rejects.toThrow(/boom/);
    expect(mockClient.release).toHaveBeenCalled();
  });
});
