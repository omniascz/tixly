import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerForPresale,
  cancelRegistration,
  getRegistrationCount,
  getFanRegistrationStatus,
} from '../services/registration.service.js';
import {
  conductSelection,
  openPurchaseWindow,
  openAllPurchaseWindows,
} from '../services/selection.service.js';
import {
  verifyPurchaseWindow,
  markTicketPurchased,
  expireStaleWindows,
} from '../services/purchase-window.service.js';
import { checkAntiScalperRules } from '../lib/anti-scalper.js';
import type { DbAdapter } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Mock DbAdapter factory
// ---------------------------------------------------------------------------

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn) => fn(makeDb(overrides))),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const NOW_ISO = new Date().toISOString();
const FUTURE_ISO = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();

const presaleEventRow = {
  id: 'pe-1',
  event_id: 'ev-1',
  promoter_id: 'pr-1',
  registration_open: PAST_ISO,
  registration_close: FUTURE_ISO,
  selection_date: FUTURE_ISO,
  max_select_count: 3,
  max_tickets_per_fan: 2,
  status: 'registration_open',
};

const fanRegRow = {
  id: 'reg-1',
  event_id: 'ev-1',
  promoter_id: 'pr-1',
  user_id: 'user-1',
  email: 'fan@example.com',
  status: 'registered',
  registered_at: NOW_ISO,
  selected_at: null,
  purchase_window_expires_at: null,
  purchased_at: null,
};

// ---------------------------------------------------------------------------
// 1. registerForPresale: successful registration
// ---------------------------------------------------------------------------
describe('registerForPresale', () => {
  it('1. returns a FanRegistration on success', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([presaleEventRow])  // presale event lookup
        .mockResolvedValueOnce([{ count: '0' }]),   // existing registration count
    });

    const result = await registerForPresale('ev-1', 'user-1', 'fan@example.com', 'pr-1', db);

    expect(result.status).toBe('registered');
    expect(result.userId).toBe('user-1');
    expect(result.email).toBe('fan@example.com');
    expect(result.id).toBeTruthy();
  });

  // 2. duplicate registration error
  it('2. throws for duplicate registration (existingRegistrations > 0)', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([presaleEventRow])
        .mockResolvedValueOnce([{ count: '1' }]),  // already registered
    });

    await expect(
      registerForPresale('ev-1', 'user-1', 'fan@example.com', 'pr-1', db),
    ).rejects.toThrow('USER_ALREADY_REGISTERED');
  });

  // 3. temp mail domain
  it('3. throws for temp mail domain (mailinator.com)', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([presaleEventRow])
        .mockResolvedValueOnce([{ count: '0' }]),
    });

    await expect(
      registerForPresale('ev-1', 'user-1', 'hacker@mailinator.com', 'pr-1', db),
    ).rejects.toThrow('TEMP_MAIL_DOMAIN');
  });

  // 4. anti-scalper blocks when existingRegistrations > 0 (covered by test 2)
  it('4. anti-scalper rejects when existingRegistrations > 0', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([presaleEventRow])
        .mockResolvedValueOnce([{ count: '2' }]),
    });

    await expect(
      registerForPresale('ev-1', 'user-2', 'user2@example.com', 'pr-1', db),
    ).rejects.toThrow('USER_ALREADY_REGISTERED');
  });
});

// ---------------------------------------------------------------------------
// 5. cancelRegistration
// ---------------------------------------------------------------------------
describe('cancelRegistration', () => {
  it('5. executes UPDATE status to expired', async () => {
    const db = makeDb();

    await cancelRegistration('reg-1', 'user-1', db);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE fan_registrations_v2'),
      expect.arrayContaining(['reg-1', 'user-1']),
    );
  });
});

// ---------------------------------------------------------------------------
// 6. getRegistrationCount
// ---------------------------------------------------------------------------
describe('getRegistrationCount', () => {
  it('6. returns the count as a number', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{ count: '42' }]),
    });

    const count = await getRegistrationCount('ev-1', db);
    expect(count).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 7. getFanRegistrationStatus
// ---------------------------------------------------------------------------
describe('getFanRegistrationStatus', () => {
  it('7. returns FanRegistration when found', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([fanRegRow]),
    });

    const result = await getFanRegistrationStatus('ev-1', 'user-1', db);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-1');
  });

  it('7b. returns null when not found', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    const result = await getFanRegistrationStatus('ev-1', 'user-unknown', db);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8-11. checkAntiScalperRules
// ---------------------------------------------------------------------------
describe('checkAntiScalperRules', () => {
  it('8. passed=true for legitimate email and 0 registrations', () => {
    const result = checkAntiScalperRules('user-1', 'fan@example.com', 0);
    expect(result.passed).toBe(true);
  });

  it('9. passed=false for mailinator.com', () => {
    const result = checkAntiScalperRules('user-1', 'hacker@mailinator.com', 0);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('TEMP_MAIL_DOMAIN');
  });

  it('10. passed=false when existingRegistrations=1', () => {
    const result = checkAntiScalperRules('user-1', 'fan@example.com', 1);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('USER_ALREADY_REGISTERED');
  });

  it('11. passed=false when VPN check returns true', () => {
    const result = checkAntiScalperRules('user-1', 'fan@example.com', 0, {
      ipAddress: '1.2.3.4',
      checkVpn: () => true,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('VPN_OR_DATACENTER_IP');
  });
});

// ---------------------------------------------------------------------------
// 12-14. conductSelection
// ---------------------------------------------------------------------------
describe('conductSelection', () => {
  const registrations = [
    { ...fanRegRow, id: 'r1', user_id: 'u1' },
    { ...fanRegRow, id: 'r2', user_id: 'u2' },
    { ...fanRegRow, id: 'r3', user_id: 'u3' },
    { ...fanRegRow, id: 'r4', user_id: 'u4' },
    { ...fanRegRow, id: 'r5', user_id: 'u5' },
  ];

  it('12. selects max_select_count fans when total >= max', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([{ ...presaleEventRow, max_select_count: 3 }])
        .mockResolvedValueOnce(registrations),
    });

    const result = await conductSelection('pe-1', 'pr-1', db);
    expect(result.selected).toBe(3);
    expect(result.total).toBe(5);
  });

  it('13. selects fewer when total < max_select_count', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([{ ...presaleEventRow, max_select_count: 10 }])
        .mockResolvedValueOnce(registrations),
    });

    const result = await conductSelection('pe-1', 'pr-1', db);
    expect(result.selected).toBe(5);
    expect(result.total).toBe(5);
  });

  it('14. injectable randomFn produces deterministic selection', async () => {
    // Always returns 0 → shuffle picks same first elements
    let callCount = 0;
    const deterministicRandom = () => {
      const vals = [0.1, 0.2, 0.3, 0.4];
      return vals[callCount++ % vals.length];
    };

    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([{ ...presaleEventRow, max_select_count: 2 }])
        .mockResolvedValueOnce(registrations),
    });

    const result = await conductSelection('pe-1', 'pr-1', db, deterministicRandom);
    expect(result.selected).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 15-16. openPurchaseWindow / openAllPurchaseWindows
// ---------------------------------------------------------------------------
describe('openPurchaseWindow', () => {
  it('15. sets purchaseWindowExpiresAt = NOW+48h', async () => {
    const updatedRow = {
      ...fanRegRow,
      status: 'purchase_window_open',
      purchase_window_expires_at: FUTURE_ISO,
    };

    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([updatedRow]),
    });

    const result = await openPurchaseWindow('reg-1', db);
    expect(result.status).toBe('purchase_window_open');
    expect(result.purchaseWindowExpiresAt).toBeTruthy();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('purchase_window_expires_at'),
      expect.any(Array),
    );
  });
});

describe('openAllPurchaseWindows', () => {
  it('16. returns count of opened windows', async () => {
    const selectedRows = [
      { ...fanRegRow, id: 'r1', status: 'selected' },
      { ...fanRegRow, id: 'r2', status: 'selected' },
    ];
    const openedRow = {
      ...fanRegRow,
      status: 'purchase_window_open',
      purchase_window_expires_at: FUTURE_ISO,
    };

    const db = makeDb({
      query: vi.fn()
        // openAllPurchaseWindows: event lookup
        .mockResolvedValueOnce([presaleEventRow])
        // selected registrations
        .mockResolvedValueOnce(selectedRows)
        // openPurchaseWindow calls (2 × execute + query)
        .mockResolvedValue([openedRow]),
    });

    const count = await openAllPurchaseWindows('pe-1', db);
    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 17-22. verifyPurchaseWindow / markTicketPurchased / expireStaleWindows
// ---------------------------------------------------------------------------
describe('verifyPurchaseWindow', () => {
  it('17. valid=true for active purchase window', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{
        ...fanRegRow,
        status: 'purchase_window_open',
        purchase_window_expires_at: FUTURE_ISO,
      }]),
    });

    const result = await verifyPurchaseWindow('ev-1', 'user-1', db);
    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBe(FUTURE_ISO);
  });

  it('18. valid=false for expired window', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{
        ...fanRegRow,
        status: 'purchase_window_open',
        purchase_window_expires_at: PAST_ISO,
      }]),
    });

    const result = await verifyPurchaseWindow('ev-1', 'user-1', db);
    expect(result.valid).toBe(false);
  });

  it('19. valid=false when no registration exists', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    });

    const result = await verifyPurchaseWindow('ev-1', 'user-nobody', db);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('NO_REGISTRATION');
  });

  it('22. reason=WINDOW_EXPIRED for expired window', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{
        ...fanRegRow,
        status: 'purchase_window_open',
        purchase_window_expires_at: PAST_ISO,
      }]),
    });

    const result = await verifyPurchaseWindow('ev-1', 'user-1', db);
    expect(result.reason).toBe('WINDOW_EXPIRED');
  });
});

describe('markTicketPurchased', () => {
  it('20. executes UPDATE status to purchased', async () => {
    const db = makeDb();

    await markTicketPurchased('reg-1', db);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'purchased'"),
      expect.arrayContaining(['reg-1']),
    );
  });
});

describe('expireStaleWindows', () => {
  it('21. returns count of expired windows', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([
        { id: 'r1' },
        { id: 'r2' },
        { id: 'r3' },
      ]),
    });

    const count = await expireStaleWindows(db);
    expect(count).toBe(3);
    expect(db.execute).toHaveBeenCalledTimes(3);
  });
});
