import { describe, it, expect } from 'vitest';
import { calculateFeeForItem, calculateFeeForOrder } from '../lib/fee-calculator';
import { FeeError } from '../lib/fee-errors';
import type { FeeSchedule } from '../types/fees';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSchedule(
  overrides: Partial<Pick<FeeSchedule, 'id' | 'percentageFee' | 'fixedFee' | 'minFee' | 'maxFee'>> = {},
): Pick<FeeSchedule, 'id' | 'percentageFee' | 'fixedFee' | 'minFee' | 'maxFee'> {
  return {
    id: 'sch-0000-0000-0000-000000000001',
    percentageFee: 0,
    fixedFee: 0,
    minFee: null,
    maxFee: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateFeeForItem
// ---------------------------------------------------------------------------
describe('calculateFeeForItem', () => {
  it('5% fee na 100 000 haléřů (1 000 Kč) = 5 000 haléřů fee', () => {
    const schedule = makeSchedule({ percentageFee: 500 });
    const result = calculateFeeForItem(100_000, schedule);
    expect(result.platformFee).toBe(5_000);
    expect(result.percentageAmount).toBe(5_000);
    expect(result.promoterAmount).toBe(95_000);
  });

  it('fixní poplatek: 0% + 1500 haléřů = 1500 fee', () => {
    const schedule = makeSchedule({ percentageFee: 0, fixedFee: 1_500 });
    const result = calculateFeeForItem(50_000, schedule);
    expect(result.platformFee).toBe(1_500);
    expect(result.fixedAmount).toBe(1_500);
    expect(result.percentageAmount).toBe(0);
  });

  it('kombinovaný: 5% + 500 haléřů na 10 000 haléřů → (500 + 500) = 1000 haléřů fee', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 500 });
    const result = calculateFeeForItem(10_000, schedule);
    // 5% z 10 000 = 500, + 500 fixní = 1000
    expect(result.percentageAmount).toBe(500);
    expect(result.fixedAmount).toBe(500);
    expect(result.rawFee).toBe(1_000);
    expect(result.platformFee).toBe(1_000);
  });

  it('min fee: raw=300, min=500 → výsledek=500', () => {
    const schedule = makeSchedule({ percentageFee: 100, fixedFee: 0, minFee: 500 });
    // 1% z 5 000 = 50 haléřů raw, ale min=500 → výsledek 500
    // Zvolíme cenu 3_000: 1% = 30, raw=30, min=500 → 500
    const result = calculateFeeForItem(3_000, schedule);
    expect(result.rawFee).toBeLessThan(500);
    expect(result.platformFee).toBe(500);
  });

  it('max fee: raw=2000, max=1500 → výsledek=1500', () => {
    const schedule = makeSchedule({ percentageFee: 1000, fixedFee: 0, maxFee: 1_500 });
    // 10% z 20 000 = 2 000 raw, max=1500 → 1500
    const result = calculateFeeForItem(20_000, schedule);
    expect(result.rawFee).toBe(2_000);
    expect(result.platformFee).toBe(1_500);
  });

  it('nulová cena: fee = fixedFee (0% + 500 fixní = 500)', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 500 });
    const result = calculateFeeForItem(0, schedule);
    expect(result.percentageAmount).toBe(0);
    expect(result.platformFee).toBe(500);
    expect(result.promoterAmount).toBe(-500);
  });

  it('výsledek je vždy INTEGER — žádné desetinné hodnoty', () => {
    const schedule = makeSchedule({ percentageFee: 333 }); // 3.33%
    const result = calculateFeeForItem(10_001, schedule);
    expect(Number.isInteger(result.platformFee)).toBe(true);
    expect(Number.isInteger(result.percentageAmount)).toBe(true);
    expect(Number.isInteger(result.promoterAmount)).toBe(true);
  });

  it('promoterAmount = ticketPrice - platformFee', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 200 });
    const result = calculateFeeForItem(8_000, schedule);
    expect(result.promoterAmount).toBe(result.ticketPrice - result.platformFee);
  });

  it('promoterAmount může být záporný (levná vstupenka, vysoký fixní poplatek)', () => {
    const schedule = makeSchedule({ percentageFee: 0, fixedFee: 5_000 });
    const result = calculateFeeForItem(1_000, schedule);
    expect(result.promoterAmount).toBe(-4_000);
  });

  it('percentageAmount správně zaokrouhlen (Math.round): 333 haléřů × 5% → 17 haléřů', () => {
    const schedule = makeSchedule({ percentageFee: 500 });
    // 333 * 500 / 10000 = 16.65 → Math.round → 17
    const result = calculateFeeForItem(333, schedule);
    expect(result.percentageAmount).toBe(17);
  });

  it('0% fee + 0 fixní → fee = 0, promoterAmount = ticketPrice', () => {
    const schedule = makeSchedule({ percentageFee: 0, fixedFee: 0 });
    const result = calculateFeeForItem(50_000, schedule);
    expect(result.platformFee).toBe(0);
    expect(result.promoterAmount).toBe(50_000);
  });

  it('vyhodí INVALID_PRICE pro zápornou cenu', () => {
    const schedule = makeSchedule();
    expect(() => calculateFeeForItem(-1, schedule)).toThrow(FeeError);
    try {
      calculateFeeForItem(-1, schedule);
    } catch (err) {
      expect(err).toBeInstanceOf(FeeError);
      expect((err as FeeError).code).toBe('INVALID_PRICE');
    }
  });

  it('max fee aplikován per item (ne na celkovou objednávku)', () => {
    const schedule = makeSchedule({ percentageFee: 500, maxFee: 1_000 });
    // Per item 50 000 haléřů: 5% = 2 500, max=1 000 → každý item má fee 1 000
    const result1 = calculateFeeForItem(50_000, schedule);
    const result2 = calculateFeeForItem(50_000, schedule);
    expect(result1.platformFee).toBe(1_000);
    expect(result2.platformFee).toBe(1_000);
  });

  it('min fee aplikován per item', () => {
    const schedule = makeSchedule({ percentageFee: 100, minFee: 200 });
    // 1% z 100 haléřů = 1, min=200 → každý item 200
    const result = calculateFeeForItem(100, schedule);
    expect(result.platformFee).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// calculateFeeForOrder
// ---------------------------------------------------------------------------
describe('calculateFeeForOrder', () => {
  it('2 line items s quantity=3 → 6 FeeCalculation záznamů a správné summy', () => {
    const schedule = makeSchedule({ percentageFee: 500 });
    const result = calculateFeeForOrder(
      [
        { price: 10_000, quantity: 2 },
        { price: 20_000, quantity: 1 },
      ],
      schedule,
    );
    expect(result.lineItems).toHaveLength(3);
    expect(result.totalGrossRevenue).toBe(10_000 + 10_000 + 20_000);
    expect(result.totalPlatformFee).toBe(500 + 500 + 1_000);
    expect(result.totalPromoterPayout).toBe(
      result.totalGrossRevenue - result.totalPlatformFee,
    );
  });

  it('mixed prices → součet sedí', () => {
    const schedule = makeSchedule({ percentageFee: 1000, fixedFee: 100 });
    const result = calculateFeeForOrder(
      [
        { price: 5_000, quantity: 2 },
        { price: 15_000, quantity: 1 },
      ],
      schedule,
    );
    const expectedGross = 5_000 * 2 + 15_000;
    expect(result.totalGrossRevenue).toBe(expectedGross);
    // Ověříme, že totalPlatformFee = součet per-item fees
    const manualFees = result.lineItems.reduce((sum, li) => sum + li.platformFee, 0);
    expect(result.totalPlatformFee).toBe(manualFees);
  });

  it('quantity=1 → stejné jako calculateFeeForItem', () => {
    const schedule = makeSchedule({ percentageFee: 500, fixedFee: 300 });
    const orderResult = calculateFeeForOrder([{ price: 12_000, quantity: 1 }], schedule);
    const itemResult = calculateFeeForItem(12_000, schedule);
    expect(orderResult.lineItems).toHaveLength(1);
    expect(orderResult.lineItems[0].platformFee).toBe(itemResult.platformFee);
    expect(orderResult.totalPlatformFee).toBe(itemResult.platformFee);
  });

  it('totalGrossRevenue = součet všech (price × quantity)', () => {
    const schedule = makeSchedule({ percentageFee: 200 });
    const items = [
      { price: 7_500, quantity: 3 },
      { price: 12_000, quantity: 2 },
    ];
    const result = calculateFeeForOrder(items, schedule);
    const expected = 7_500 * 3 + 12_000 * 2;
    expect(result.totalGrossRevenue).toBe(expected);
  });

  it('totalPlatformFee = součet všech platform fees', () => {
    const schedule = makeSchedule({ percentageFee: 500 });
    const result = calculateFeeForOrder(
      [{ price: 10_000, quantity: 3 }],
      schedule,
    );
    expect(result.totalPlatformFee).toBe(500 * 3);
  });
});
