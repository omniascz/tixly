import { describe, it, expect } from 'vitest';
import { resolveServiceFee } from './service-fee';

/** Fake exec vracející předdefinovaný fee_schedule řádek (nebo prázdno). */
function fakeExec(row: { buyer_fee_halire: number; buyer_fee_basis: string } | null) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async query() {
      return { rows: row ? [row] : [] };
    },
  } as unknown as Parameters<typeof resolveServiceFee>[0];
}

describe('resolveServiceFee', () => {
  it('per_ticket: fee × počet vstupenek', async () => {
    const r = await resolveServiceFee(
      fakeExec({ buyer_fee_halire: 2000, buyer_fee_basis: 'per_ticket' }),
      { promoterId: 'p', currency: 'CZK', quantity: 3 },
    );
    expect(r.totalFeeMinor).toBe(6000);
    expect(r.basis).toBe('per_ticket');
  });

  it('per_order: fee jednou bez ohledu na počet', async () => {
    const r = await resolveServiceFee(
      fakeExec({ buyer_fee_halire: 3000, buyer_fee_basis: 'per_order' }),
      { promoterId: 'p', currency: 'CZK', quantity: 5 },
    );
    expect(r.totalFeeMinor).toBe(3000);
  });

  it('žádný fee_schedule → 0 (default stav, žádná přirážka)', async () => {
    const r = await resolveServiceFee(fakeExec(null), { promoterId: 'p', currency: 'CZK', quantity: 4 });
    expect(r.totalFeeMinor).toBe(0);
  });

  it('fee 0 → 0 i pro per_ticket', async () => {
    const r = await resolveServiceFee(
      fakeExec({ buyer_fee_halire: 0, buyer_fee_basis: 'per_ticket' }),
      { promoterId: 'p', currency: 'CZK', quantity: 10 },
    );
    expect(r.totalFeeMinor).toBe(0);
  });

  it('quantity < 1 se ošetří jako 1', async () => {
    const r = await resolveServiceFee(
      fakeExec({ buyer_fee_halire: 2000, buyer_fee_basis: 'per_ticket' }),
      { promoterId: 'p', currency: 'CZK', quantity: 0 },
    );
    expect(r.totalFeeMinor).toBe(2000);
  });
});
