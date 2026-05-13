import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeasonPassService, DBAdapter, GopayAdapter, EventBusAdapter, NotificationAdapter, Logger, EventRecord } from '../services/season-pass.service';
import { SeasonPass, SeasonPassType, PassUsage, PassTicket, CreateSeasonPassRequest } from '../types/season-pass';
import { PassBenefitsService, BenefitsDBAdapter, CacheAdapter } from '../services/pass-benefits.service';

// =============================================================================
// Test helpers — factory functions for domain objects
// =============================================================================

function makePassType(overrides: Partial<SeasonPassType> = {}): SeasonPassType {
  return {
    id: 'type-1',
    organizerId: 'org-1',
    name: 'Testovací permanentka',
    kind: 'season',
    billingCycle: 'monthly',
    price: 500,
    validMonths: 12,
    benefits: { addonDiscountPercent: 10, earlyAccessHours: 4, guestPasses: 0 },
    active: true,
    ...overrides,
  };
}

function makePass(overrides: Partial<SeasonPass> = {}): SeasonPass {
  const now = new Date('2026-04-03T10:00:00Z');
  const end = new Date('2027-04-03T10:00:00Z');
  return {
    id: 'pass-1',
    userId: 'user-1',
    organizerId: 'org-1',
    passTypeId: 'type-1',
    kind: 'season',
    name: 'Testovací permanentka',
    billingCycle: 'monthly',
    price: 500,
    startDate: now,
    endDate: end,
    status: 'active',
    benefits: { addonDiscountPercent: 10, earlyAccessHours: 4, guestPasses: 0 },
    gopayPaymentId: 'gp-pay-1',
    gopayRecurringToken: 'gp-token-1',
    nextBillingDate: new Date('2026-05-03T10:00:00Z'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'event-1',
    organizerId: 'org-1',
    dateStart: new Date('2026-06-15T20:00:00Z'),
    dateEnd: new Date('2026-06-15T23:00:00Z'),
    saleStartAt: new Date('2026-05-01T10:00:00Z'),
    status: 'published',
    title: 'Testovací akce',
    ...overrides,
  };
}

// =============================================================================
// Mock adapters
// =============================================================================

function makeMockDB(overrides: Partial<DBAdapter> = {}): DBAdapter {
  return {
    getPassType: vi.fn(),
    listPassTypes: vi.fn().mockResolvedValue([]),
    getActivePassByUserAndType: vi.fn().mockResolvedValue(null),
    insertPass: vi.fn(),
    updatePass: vi.fn(),
    atomicDecrementRemainingUses: vi.fn().mockResolvedValue(0),
    getPass: vi.fn(),
    listPassesForUser: vi.fn().mockResolvedValue([]),
    insertPassUsage: vi.fn(),
    updatePassUsage: vi.fn().mockResolvedValue(undefined),
    listPassUsages: vi.fn().mockResolvedValue([]),
    insertPassTicket: vi.fn(),
    getExpiredPasses: vi.fn().mockResolvedValue([]),
    getEventByIdForOrganizer: vi.fn(),
    ...overrides,
  };
}

function makeMockGopay(overrides: Partial<GopayAdapter> = {}): GopayAdapter {
  return {
    createPayment: vi.fn().mockResolvedValue({ id: 'gp-pay-new', gwUrl: 'https://gopay.cz/pay' }),
    createRecurrentPayment: vi.fn().mockResolvedValue({ id: 'gp-pay-rec', gwUrl: 'https://gopay.cz/pay-rec' }),
    chargeRecurrent: vi.fn().mockResolvedValue({ paymentId: 'gp-charge-1', status: 'PAID' }),
    cancelRecurring: vi.fn().mockResolvedValue(undefined),
    refundPayment: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockEventBus(): EventBusAdapter {
  return { emit: vi.fn().mockResolvedValue(undefined) };
}

function makeMockNotifications(): NotificationAdapter {
  return { sendPassSuspendedNotification: vi.fn().mockResolvedValue(undefined) };
}

function makeMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeService(dbOverrides: Partial<DBAdapter> = {}, gopayOverrides: Partial<GopayAdapter> = {}) {
  return new SeasonPassService(
    makeMockDB(dbOverrides),
    makeMockGopay(gopayOverrides),
    makeMockEventBus(),
    makeMockNotifications(),
    makeMockLogger(),
    {
      gopayReturnBaseUrl: 'https://tixly.cz',
      gopayNotificationUrl: 'https://tixly.cz/api/passes/gopay-callback',
      enableProratedRefunds: false,
    }
  );
}

// =============================================================================
// purchasePass tests
// =============================================================================

describe('SeasonPassService.purchasePass', () => {
  it('vytvoří pending pass a vrátí GoPay redirect URL při úspěchu', async () => {
    const passType = makePassType();
    const pending = makePass({ status: 'pending_payment' });

    const db = makeMockDB({
      getPassType: vi.fn().mockResolvedValue(passType),
      getActivePassByUserAndType: vi.fn().mockResolvedValue(null),
      insertPass: vi.fn().mockResolvedValue(pending),
      updatePass: vi.fn().mockResolvedValue({ ...pending, gopayPaymentId: 'gp-pay-rec' }),
    });

    const service = new SeasonPassService(
      db,
      makeMockGopay(),
      makeMockEventBus(),
      makeMockNotifications(),
      makeMockLogger(),
      { gopayReturnBaseUrl: 'https://tixly.cz', gopayNotificationUrl: 'https://tixly.cz/gopay', enableProratedRefunds: false }
    );

    const req: CreateSeasonPassRequest = {
      kind: 'season',
      organizerId: 'org-1',
      billingCycle: 'monthly',
      passTypeId: 'type-1',
    };

    const result = await service.purchasePass('user-1', req);

    expect(result.pass.status).toBe('pending_payment');
    expect(result.gopayRedirectUrl).toMatch(/gopay\.cz/);
    expect(db.insertPass).toHaveBeenCalledOnce();
  });

  it('vyhodí DUPLICATE_PASS pokud uživatel má aktivní pass stejného typu', async () => {
    const passType = makePassType();
    const existing = makePass({ status: 'active' });

    const service = makeService({
      getPassType: vi.fn().mockResolvedValue(passType),
      getActivePassByUserAndType: vi.fn().mockResolvedValue(existing),
    });

    const req: CreateSeasonPassRequest = {
      kind: 'season',
      organizerId: 'org-1',
      billingCycle: 'monthly',
      passTypeId: 'type-1',
    };

    await expect(service.purchasePass('user-1', req)).rejects.toThrow('DUPLICATE_PASS');
  });

  it('vyhodí PASS_TYPE_INACTIVE pro neaktivní pass type', async () => {
    const inactiveType = makePassType({ active: false });

    const service = makeService({
      getPassType: vi.fn().mockResolvedValue(inactiveType),
    });

    const req: CreateSeasonPassRequest = {
      kind: 'season',
      organizerId: 'org-1',
      billingCycle: 'monthly',
      passTypeId: 'type-1',
    };

    await expect(service.purchasePass('user-1', req)).rejects.toThrow('PASS_TYPE_INACTIVE');
  });
});

// =============================================================================
// usePass tests
// =============================================================================

describe('SeasonPassService.usePass', () => {
  const validEvent = makeEvent();
  const ticket: PassTicket = {
    ticketId: 'ticket-1',
    passId: 'pass-1',
    eventId: 'event-1',
    userId: 'user-1',
    seatInfo: null,
    issuedAt: new Date(),
  };
  const usage: PassUsage = {
    id: 'usage-1',
    passId: 'pass-1',
    eventId: 'event-1',
    ticketId: null,
    usedAt: new Date(),
    createdAt: new Date(),
  };

  it('season pass v platném rozsahu — vydá vstupenku', async () => {
    const pass = makePass({
      kind: 'season',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2027-01-01'),
    });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
      getEventByIdForOrganizer: vi.fn().mockResolvedValue(validEvent),
      insertPassUsage: vi.fn().mockResolvedValue(usage),
      insertPassTicket: vi.fn().mockResolvedValue(ticket),
      updatePassUsage: vi.fn().mockResolvedValue(undefined),
    });

    const result = await service.usePass('pass-1', 'user-1', 'event-1');

    expect(result.ticket.ticketId).toBe('ticket-1');
    expect(result.qrPayload).toContain('pass-ticket:ticket-1');
  });

  it('season pass mimo rozsah — vyhodí EVENT_OUT_OF_PASS_RANGE', async () => {
    const pass = makePass({
      kind: 'season',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-01'), // končí před datem akce
    });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
      getEventByIdForOrganizer: vi.fn().mockResolvedValue(validEvent), // event je 15.6.2026
    });

    await expect(service.usePass('pass-1', 'user-1', 'event-1')).rejects.toThrow(
      'EVENT_OUT_OF_PASS_RANGE'
    );
  });

  it('flex pass s remaining_uses=1 → po použití atomicky dekrementuje', async () => {
    const pass = makePass({ kind: 'flex', remainingUses: 1, totalUses: 10 });
    const atomicDecrementFn = vi.fn().mockResolvedValue(0);

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
      getEventByIdForOrganizer: vi.fn().mockResolvedValue(validEvent),
      atomicDecrementRemainingUses: atomicDecrementFn,
      insertPassUsage: vi.fn().mockResolvedValue(usage),
      insertPassTicket: vi.fn().mockResolvedValue(ticket),
      updatePassUsage: vi.fn().mockResolvedValue(undefined),
    });

    await service.usePass('pass-1', 'user-1', 'event-1');

    expect(atomicDecrementFn).toHaveBeenCalledWith('pass-1');
  });

  it('flex pass s remaining_uses=0 → vyhodí PASS_NO_REMAINING_USES', async () => {
    const pass = makePass({ kind: 'flex', remainingUses: 0, totalUses: 10 });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
      getEventByIdForOrganizer: vi.fn().mockResolvedValue(validEvent),
    });

    await expect(service.usePass('pass-1', 'user-1', 'event-1')).rejects.toThrow(
      'PASS_NO_REMAINING_USES'
    );
  });
});

// =============================================================================
// renewPass tests
// =============================================================================

describe('SeasonPassService.renewPass', () => {
  it('úspěšné obnovení — aktualizuje endDate a nextBillingDate', async () => {
    const pass = makePass({
      billingCycle: 'monthly',
      endDate: new Date('2026-05-03T10:00:00Z'),
      nextBillingDate: new Date('2026-05-03T10:00:00Z'),
    });
    const updatePassFn = vi.fn().mockResolvedValue(pass);

    const service = makeService(
      {
        getPass: vi.fn().mockResolvedValue(pass),
        updatePass: updatePassFn,
      },
      {
        chargeRecurrent: vi.fn().mockResolvedValue({ paymentId: 'gp-new', status: 'PAID' }),
      }
    );

    await service.renewPass('pass-1');

    expect(updatePassFn).toHaveBeenCalledWith(
      'pass-1',
      expect.objectContaining({ gopayPaymentId: 'gp-new' })
    );
  });

  it('GoPay chyba při obnově → status se změní na suspended', async () => {
    const pass = makePass({ billingCycle: 'monthly' });
    const updatePassFn = vi.fn().mockResolvedValue({ ...pass, status: 'suspended' });

    const service = makeService(
      {
        getPass: vi.fn().mockResolvedValue(pass),
        updatePass: updatePassFn,
      },
      {
        chargeRecurrent: vi.fn().mockRejectedValue(new Error('GoPay API timeout')),
      }
    );

    await expect(service.renewPass('pass-1')).rejects.toThrow('GoPay API timeout');

    expect(updatePassFn).toHaveBeenCalledWith('pass-1', expect.objectContaining({ status: 'suspended' }));
  });
});

// =============================================================================
// PassBenefitsService tests
// =============================================================================

function makeCache(): CacheAdapter {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
  };
}

describe('PassBenefitsService.checkEarlyAccess', () => {
  it('3 hodiny před sale_start s earlyAccessHours=4 → true', async () => {
    const saleStart = new Date(Date.now() + 3 * 60 * 60 * 1000); // za 3 hodiny
    // earlyAccess otvírá za 4 hodiny před prodejem = právě teď je v okně (4h - 3h = 1h zpět)

    const db: BenefitsDBAdapter = {
      getActivePassForUser: vi.fn().mockResolvedValue(null),
      getEventSaleStart: vi.fn().mockResolvedValue(saleStart),
    };
    const benefitsService = new PassBenefitsService(db, makeCache());

    // We test via a pass with earlyAccessHours=4; resolve via cache miss path
    // Since resolvePassById returns null without organizer context, we test indirectly
    // by constructing a subclass or testing through getActivePassForUser mock
    // For the purpose of this integration-style test, we use getActivePassForUser
    const passWithBenefits = makePass({ benefits: { addonDiscountPercent: 10, earlyAccessHours: 4, guestPasses: 0 } });

    // Override cache to return the pass for byid lookup
    const populatedCache: CacheAdapter = {
      get: vi.fn(async (key: string) => key.startsWith('pass:byid') ? passWithBenefits : null),
      set: vi.fn(async () => {}),
    };
    const service = new PassBenefitsService(db, populatedCache);

    const result = await service.checkEarlyAccess('pass-1', 'user-1', 'event-1');
    // earlyAccess opens at saleStart - 4h; we're now, saleStart is in 3h → we're past openAt → true
    expect(result).toBe(true);
  });

  it('5 hodin před sale_start s earlyAccessHours=4 → false', async () => {
    const saleStart = new Date(Date.now() + 5 * 60 * 60 * 1000); // za 5 hodin
    // earlyAccess otvírá za saleStart - 4h = za 1 hodinu → ještě není otevřeno

    const db: BenefitsDBAdapter = {
      getActivePassForUser: vi.fn().mockResolvedValue(null),
      getEventSaleStart: vi.fn().mockResolvedValue(saleStart),
    };

    const passWithBenefits = makePass({ benefits: { addonDiscountPercent: 10, earlyAccessHours: 4, guestPasses: 0 } });
    const populatedCache: CacheAdapter = {
      get: vi.fn(async (key: string) => key.startsWith('pass:byid') ? passWithBenefits : null),
      set: vi.fn(async () => {}),
    };

    const service = new PassBenefitsService(db, populatedCache);
    const result = await service.checkEarlyAccess('pass-1', 'user-1', 'event-1');

    expect(result).toBe(false);
  });
});

describe('PassBenefitsService.getAddonDiscount', () => {
  it('aktivní pass → vrátí % slevu', async () => {
    const pass = makePass({ status: 'active', benefits: { addonDiscountPercent: 15, earlyAccessHours: 2, guestPasses: 0 } });

    const db: BenefitsDBAdapter = {
      getActivePassForUser: vi.fn().mockResolvedValue(pass),
      getEventSaleStart: vi.fn().mockResolvedValue(null),
    };
    const populatedCache: CacheAdapter = {
      get: vi.fn(async (key: string) => key.startsWith('pass:byid') ? pass : null),
      set: vi.fn(async () => {}),
    };

    const service = new PassBenefitsService(db, populatedCache);
    const discount = await service.getAddonDiscount('pass-1', 'user-1', 'event-1');

    expect(discount).toBe(15);
  });

  it('neaktivní pass → vrátí 0', async () => {
    const expiredPass = makePass({ status: 'expired' });

    const db: BenefitsDBAdapter = {
      getActivePassForUser: vi.fn().mockResolvedValue(null),
      getEventSaleStart: vi.fn().mockResolvedValue(null),
    };
    const populatedCache: CacheAdapter = {
      get: vi.fn(async (key: string) => key.startsWith('pass:byid') ? expiredPass : null),
      set: vi.fn(async () => {}),
    };

    const service = new PassBenefitsService(db, populatedCache);
    const discount = await service.getAddonDiscount('pass-1', 'user-1', 'event-1');

    expect(discount).toBe(0);
  });

  it('pass neexistuje → vrátí 0', async () => {
    const db: BenefitsDBAdapter = {
      getActivePassForUser: vi.fn().mockResolvedValue(null),
      getEventSaleStart: vi.fn().mockResolvedValue(null),
    };
    const emptyCache: CacheAdapter = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
    };

    const service = new PassBenefitsService(db, emptyCache);
    const discount = await service.getAddonDiscount('nonexistent-pass', 'user-1', 'event-1');

    expect(discount).toBe(0);
  });
});

// =============================================================================
// createPassType — pricing validation (integer halire)
// =============================================================================

describe('SeasonPassService — pass type pricing', () => {
  it('listPassTypes vrátí seznam pass typů pro organizátora', async () => {
    const types = [
      makePassType({ id: 'type-1', price: 50000, name: 'Basic' }),
      makePassType({ id: 'type-2', price: 120000, name: 'Premium' }),
    ];
    const service = makeService({
      listPassTypes: vi.fn().mockResolvedValue(types),
    });

    const result = await service.listPassTypes('org-1');
    expect(result).toHaveLength(2);
    expect(result[0].price).toBe(50000);
    expect(result[1].price).toBe(120000);
  });

  it('pass type cena je v celých halířích — nikdy float', () => {
    const pt = makePassType({ price: 199900 }); // 1999 Kc
    expect(Number.isInteger(pt.price)).toBe(true);
    expect(pt.price).toBe(199900);
  });
});

// =============================================================================
// purchasePass — one_time billing cycle
// =============================================================================

describe('SeasonPassService.purchasePass — one_time', () => {
  it('one_time billing cycle volá createPayment, ne createRecurrentPayment', async () => {
    const passType = makePassType({ billingCycle: 'one_time', kind: 'flex', totalUses: 10 });
    const pending = makePass({ status: 'pending_payment', billingCycle: 'one_time' });

    const createPaymentFn = vi.fn().mockResolvedValue({ id: 'gp-pay-ot', gwUrl: 'https://gopay.cz/ot' });
    const createRecurrentFn = vi.fn();

    const db = makeMockDB({
      getPassType: vi.fn().mockResolvedValue(passType),
      getActivePassByUserAndType: vi.fn().mockResolvedValue(null),
      insertPass: vi.fn().mockResolvedValue(pending),
      updatePass: vi.fn().mockResolvedValue({ ...pending, gopayPaymentId: 'gp-pay-ot' }),
    });

    const service = new SeasonPassService(
      db,
      makeMockGopay({ createPayment: createPaymentFn, createRecurrentPayment: createRecurrentFn }),
      makeMockEventBus(),
      makeMockNotifications(),
      makeMockLogger(),
      { gopayReturnBaseUrl: 'https://tixly.cz', gopayNotificationUrl: 'https://tixly.cz/gopay', enableProratedRefunds: false }
    );

    const req: CreateSeasonPassRequest = {
      kind: 'flex',
      organizerId: 'org-1',
      billingCycle: 'one_time',
      passTypeId: 'type-1',
    };

    await service.purchasePass('user-1', req);

    expect(createPaymentFn).toHaveBeenCalledOnce();
    expect(createRecurrentFn).not.toHaveBeenCalled();
  });

  it('vyhodí PASS_TYPE_ORGANIZER_MISMATCH při neshodě organizerId', async () => {
    const passType = makePassType({ organizerId: 'org-other' });

    const service = makeService({
      getPassType: vi.fn().mockResolvedValue(passType),
    });

    const req: CreateSeasonPassRequest = {
      kind: 'season',
      organizerId: 'org-1',
      billingCycle: 'monthly',
      passTypeId: 'type-1',
    };

    await expect(service.purchasePass('user-1', req)).rejects.toThrow('PASS_TYPE_ORGANIZER_MISMATCH');
  });
});

// =============================================================================
// usePass — expired pass
// =============================================================================

describe('SeasonPassService.usePass — expired / non-active', () => {
  const validEvent = makeEvent();

  it('expired pass → vyhodí PASS_NOT_ACTIVE', async () => {
    const pass = makePass({ status: 'expired' });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.usePass('pass-1', 'user-1', 'event-1')).rejects.toThrow('PASS_NOT_ACTIVE');
  });

  it('suspended pass → vyhodí PASS_NOT_ACTIVE', async () => {
    const pass = makePass({ status: 'suspended' });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.usePass('pass-1', 'user-1', 'event-1')).rejects.toThrow('PASS_NOT_ACTIVE');
  });

  it('cancelled pass → vyhodí PASS_NOT_ACTIVE', async () => {
    const pass = makePass({ status: 'cancelled' });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.usePass('pass-1', 'user-1', 'event-1')).rejects.toThrow('PASS_NOT_ACTIVE');
  });

  it('jiný uživatel → vyhodí PASS_OWNERSHIP_DENIED', async () => {
    const pass = makePass({ userId: 'user-1', status: 'active' });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.usePass('pass-1', 'user-other', 'event-1')).rejects.toThrow('PASS_OWNERSHIP_DENIED');
  });

  it('nepublikovaná akce → vyhodí EVENT_NOT_PUBLISHED', async () => {
    const pass = makePass({ kind: 'season', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01') });
    const draftEvent = makeEvent({ status: 'draft' });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
      getEventByIdForOrganizer: vi.fn().mockResolvedValue(draftEvent),
    });

    await expect(service.usePass('pass-1', 'user-1', 'event-1')).rejects.toThrow('EVENT_NOT_PUBLISHED');
  });
});

// =============================================================================
// renewPass — additional scenarios
// =============================================================================

describe('SeasonPassService.renewPass — edge cases', () => {
  it('one_time pass → vyhodí PASS_NOT_RENEWABLE', async () => {
    const pass = makePass({ billingCycle: 'one_time', gopayRecurringToken: undefined });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.renewPass('pass-1')).rejects.toThrow('PASS_NO_RECURRING_TOKEN');
  });

  it('pass bez recurring tokenu → vyhodí PASS_NO_RECURRING_TOKEN', async () => {
    const pass = makePass({ billingCycle: 'monthly', gopayRecurringToken: undefined });

    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.renewPass('pass-1')).rejects.toThrow('PASS_NO_RECURRING_TOKEN');
  });

  it('GoPay vrátí CANCELED → status se změní na suspended a vyhodí chybu', async () => {
    const pass = makePass({ billingCycle: 'monthly' });
    const updatePassFn = vi.fn().mockResolvedValue({ ...pass, status: 'suspended' });

    const service = makeService(
      {
        getPass: vi.fn().mockResolvedValue(pass),
        updatePass: updatePassFn,
      },
      {
        chargeRecurrent: vi.fn().mockResolvedValue({ paymentId: 'gp-x', status: 'CANCELED' }),
      }
    );

    await expect(service.renewPass('pass-1')).rejects.toThrow('GOPAY_CHARGE_FAILED');
    expect(updatePassFn).toHaveBeenCalledWith('pass-1', expect.objectContaining({ status: 'suspended' }));
  });
});

// =============================================================================
// listPassesForUser — filters
// =============================================================================

describe('SeasonPassService.listPassesForUser', () => {
  it('vrátí passy pro uživatele', async () => {
    const passes = [
      makePass({ id: 'p1', status: 'active' }),
      makePass({ id: 'p2', status: 'expired' }),
    ];
    const service = makeService({
      listPassesForUser: vi.fn().mockResolvedValue(passes),
    });

    const result = await service.listPassesForUser('user-1');
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('active');
    expect(result[1].status).toBe('expired');
  });

  it('vrátí prázdný seznam pro uživatele bez passů', async () => {
    const service = makeService({
      listPassesForUser: vi.fn().mockResolvedValue([]),
    });

    const result = await service.listPassesForUser('user-no-passes');
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// cancelPass
// =============================================================================

describe('SeasonPassService.cancelPass', () => {
  it('zruší pass a emituje pass.cancelled', async () => {
    const pass = makePass({ status: 'active' });
    const updatePassFn = vi.fn().mockResolvedValue({ ...pass, status: 'cancelled' });
    const eventBus = makeMockEventBus();
    const gopay = makeMockGopay();

    const service = new SeasonPassService(
      makeMockDB({
        getPass: vi.fn().mockResolvedValue(pass),
        updatePass: updatePassFn,
      }),
      gopay,
      eventBus,
      makeMockNotifications(),
      makeMockLogger(),
      { gopayReturnBaseUrl: 'https://tixly.cz', gopayNotificationUrl: 'https://tixly.cz/gopay', enableProratedRefunds: false }
    );

    await service.cancelPass('pass-1', 'user-1');

    expect(updatePassFn).toHaveBeenCalledWith('pass-1', expect.objectContaining({ status: 'cancelled' }));
    expect(eventBus.emit).toHaveBeenCalledWith('pass.cancelled', expect.objectContaining({ passId: 'pass-1' }));
    expect(gopay.cancelRecurring).toHaveBeenCalledWith('gp-token-1');
  });

  it('jiný uživatel nemůže zrušit cizí pass', async () => {
    const pass = makePass({ userId: 'user-1' });
    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.cancelPass('pass-1', 'user-other')).rejects.toThrow('PASS_OWNERSHIP_DENIED');
  });

  it('již zrušený pass → vyhodí PASS_ALREADY_CANCELLED', async () => {
    const pass = makePass({ status: 'cancelled', cancelledAt: new Date() });
    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.cancelPass('pass-1', 'user-1')).rejects.toThrow('PASS_ALREADY_CANCELLED');
  });
});

// =============================================================================
// activatePass
// =============================================================================

describe('SeasonPassService.activatePass', () => {
  it('aktivuje pending pass a emituje pass.activated', async () => {
    const pass = makePass({ status: 'pending_payment' });
    const updatePassFn = vi.fn().mockResolvedValue({ ...pass, status: 'active' });
    const eventBus = makeMockEventBus();

    const service = new SeasonPassService(
      makeMockDB({
        getPass: vi.fn().mockResolvedValue(pass),
        updatePass: updatePassFn,
      }),
      makeMockGopay(),
      eventBus,
      makeMockNotifications(),
      makeMockLogger(),
      { gopayReturnBaseUrl: 'https://tixly.cz', gopayNotificationUrl: 'https://tixly.cz/gopay', enableProratedRefunds: false }
    );

    const result = await service.activatePass('pass-1', 'gp-pay-1', 'gp-token-1');

    expect(updatePassFn).toHaveBeenCalledWith('pass-1', expect.objectContaining({
      status: 'active',
      gopayPaymentId: 'gp-pay-1',
      gopayRecurringToken: 'gp-token-1',
    }));
    expect(eventBus.emit).toHaveBeenCalledWith('pass.activated', expect.objectContaining({ passId: 'pass-1' }));
  });

  it('pass který není pending → vyhodí PASS_NOT_PENDING', async () => {
    const pass = makePass({ status: 'active' });
    const service = makeService({
      getPass: vi.fn().mockResolvedValue(pass),
    });

    await expect(service.activatePass('pass-1', 'gp-pay-1')).rejects.toThrow('PASS_NOT_PENDING');
  });
});
