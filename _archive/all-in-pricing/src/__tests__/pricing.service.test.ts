import { describe, it, expect, vi } from 'vitest';
import {
  calculateTotalPrice,
  getPriceBreakdown,
  formatPriceDisplay,
  setOrUpdatePriceTier,
  getPricingConfig,
  setPricingConfig,
  getEventPriceTiers,
} from '../services/pricing.service.js';
import type { DbAdapter } from '../services/pricing.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const TICKET_TYPE_ID = 'tt-001';

function makePriceTierRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tier-001',
    event_id: EVENT_ID,
    ticket_type_id: TICKET_TYPE_ID,
    face_value_hellers: 50000,  // 500 CZK
    platform_fee_hellers: 5000,  // 50 CZK
    vat_rate: 21.0,
    vat_hellers: 11550,  // 21% VAT on 55000
    total_hellers: 66550,  // 665.50 CZK
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makePricingConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-001',
    promoter_id: PROMOTER_ID,
    show_breakdown: true,
    show_platform_fee: true,
    show_vat: true,
    hide_vat_value: false,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('calculateTotalPrice', () => {
  it('vypočítá celkovou cenu včetně DPH', () => {
    const result = calculateTotalPrice(50000, 5000, 21.0);

    expect(result.faceValue).toBe(50000);
    expect(result.platformFee).toBe(5000);
    expect(result.subtotal).toBe(55000);
    expect(result.vatAmount).toBe(11550);
    expect(result.total).toBe(66550);
    expect(result.vatRate).toBe(21.0);
  });

  it('vypočítá cenu s jiným DPH (15%)', () => {
    const result = calculateTotalPrice(50000, 5000, 15.0);

    expect(result.vatAmount).toBe(8250);
    expect(result.total).toBe(63250);
  });

  it('vyhodí chybu pro negativní ceny', () => {
    expect(() => calculateTotalPrice(-1000, 5000)).toThrow('VALIDATION_ERROR');
    expect(() => calculateTotalPrice(5000, -1000)).toThrow('VALIDATION_ERROR');
  });
});

describe('getPriceBreakdown', () => {
  it('vrátí rozpis ceny pro ticket type', async () => {
    const db = makeDb([[makePriceTierRow()]]);

    const result = await getPriceBreakdown(EVENT_ID, TICKET_TYPE_ID, db);

    expect(result).not.toBeNull();
    expect(result?.faceValue).toBe(50000);
    expect(result?.total).toBe(66550);
  });

  it('vrátí null pokud tier neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getPriceBreakdown(EVENT_ID, 'nonexistent', db);

    expect(result).toBeNull();
  });
});

describe('formatPriceDisplay', () => {
  it('naformátuje cenu pro zobrazení (s rozpisem)', () => {
    const breakdown = calculateTotalPrice(50000, 5000, 21.0);
    const result = formatPriceDisplay(breakdown, true);

    expect(result.total).toBe('665.50 CZK');
    expect(result.breakdown).toContain('500.00 CZK');  // face value
    expect(result.breakdown).toContain('50.00 CZK');   // fee
    expect(result.breakdown).toContain('115.50 CZK');  // VAT
  });

  it('naformátuje cenu bez rozpisu', () => {
    const breakdown = calculateTotalPrice(50000, 5000, 21.0);
    const result = formatPriceDisplay(breakdown, false);

    expect(result.total).toBe('665.50 CZK');
    expect(result.breakdown).toBeUndefined();
  });
});

describe('setOrUpdatePriceTier', () => {
  it('vytvoří nový price tier', async () => {
    const db = makeDb([[makePriceTierRow()]]);

    const result = await setOrUpdatePriceTier(
      EVENT_ID,
      TICKET_TYPE_ID,
      50000,
      5000,
      21.0,
      db,
    );

    expect(result.faceValueHellers).toBe(50000);
    expect(result.totalHellers).toBe(66550);
  });

  it('aktualizuje existující tier (upsert)', async () => {
    const db = makeDb([[makePriceTierRow({ face_value_hellers: 60000, total_hellers: 74460 })]]);

    const result = await setOrUpdatePriceTier(
      EVENT_ID,
      TICKET_TYPE_ID,
      60000,
      5000,
      21.0,
      db,
    );

    expect(result.faceValueHellers).toBe(60000);
  });
});

describe('getPricingConfig', () => {
  it('vrátí nastavení cen organizátora', async () => {
    const db = makeDb([[makePricingConfigRow()]]);

    const result = await getPricingConfig(PROMOTER_ID, db);

    expect(result).not.toBeNull();
    expect(result?.showBreakdown).toBe(true);
    expect(result?.hideVatValue).toBe(false);
  });

  it('vrátí null pokud config neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getPricingConfig('nonexistent', db);

    expect(result).toBeNull();
  });
});

describe('setPricingConfig', () => {
  it('nastaví nebo aktualizuje pricing config', async () => {
    const db = makeDb([[makePricingConfigRow({ show_breakdown: false })]]);

    const result = await setPricingConfig(PROMOTER_ID, { showBreakdown: false }, db);

    expect(result.promoterId).toBe(PROMOTER_ID);
  });

  it('skryje DPH hodnotu podle nastavení', async () => {
    const db = makeDb([[makePricingConfigRow({ hide_vat_value: true })]]);

    const result = await setPricingConfig(
      PROMOTER_ID,
      { hideVatValue: true },
      db,
    );

    expect(result.hideVatValue).toBe(true);
  });
});

describe('getEventPriceTiers', () => {
  it('vrátí všechny price tiers pro event', async () => {
    const db = makeDb([[
      makePriceTierRow({ ticket_type_id: 'tt-001' }),
      makePriceTierRow({ id: 'tier-002', ticket_type_id: 'tt-002', face_value_hellers: 100000 }),
    ]]);

    const result = await getEventPriceTiers(EVENT_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].faceValueHellers).toBe(50000);
    expect(result[1].faceValueHellers).toBe(100000);
  });
});
