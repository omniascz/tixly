import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  register,
  runSelection,
  redeemAccessLink,
  getRegistrationStatus,
  listRegistrations,
} from '../src/services/verified-fan.service';
import {
  RegistrationClosedError,
  AlreadyRegisteredError,
  AccessLinkExpiredError,
  AccessLinkAlreadyUsedError,
} from '../src/types/verified-fan.types';

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(makeDb())),
    ...overrides,
  };
}

function makeDeps(dbOverrides = {}) {
  return {
    db: makeDb(dbOverrides),
    redis: { setNx: vi.fn().mockResolvedValue(true) },
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
    email: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

const NOW = new Date('2026-06-01T10:00:00Z');
const REG_OPEN = new Date('2026-05-01T00:00:00Z');
const REG_CLOSE = new Date('2026-06-30T23:59:59Z');

const MOCK_CONFIG = {
  registration_opens_at: REG_OPEN,
  registration_closes_at: REG_CLOSE,
  event_id: 'evt_001',
  slots: 10,
  selection_method: 'random' as const,
  link_expires_after_hours: 48,
  presale_ticket_type_id: 'tt_presale',
};

// ---------------------------------------------------------------------------
// register()
// ---------------------------------------------------------------------------

describe('register()', () => {
  it('zaregistruje fana úspěšně', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([MOCK_CONFIG])             // config
      .mockResolvedValueOnce([{ id: 'reg_1', status: 'pending', registered_at: NOW }]); // INSERT

    const result = await register(deps, 'user_1', 'evt_001', NOW);

    expect(result.status).toBe('pending');
    expect(result.userId).toBe('user_1');
    expect(result.eventId).toBe('evt_001');
  });

  it('vyhodí RegistrationClosedError pokud registrace ještě nezačala', async () => {
    const deps = makeDeps();
    const future = new Date('2026-12-01T00:00:00Z');
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      ...MOCK_CONFIG,
      registration_opens_at: future,
    }]);

    await expect(register(deps, 'user_1', 'evt_001', NOW))
      .rejects.toThrow(RegistrationClosedError);
  });

  it('vyhodí RegistrationClosedError pokud registrace skončila', async () => {
    const deps = makeDeps();
    const past = new Date('2025-01-01T00:00:00Z');
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      ...MOCK_CONFIG,
      registration_closes_at: past,
    }]);

    await expect(register(deps, 'user_1', 'evt_001', NOW))
      .rejects.toThrow(RegistrationClosedError);
  });

  it('vyhodí RegistrationClosedError pokud config neexistuje', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([]);

    await expect(register(deps, 'user_1', 'evt_001', NOW))
      .rejects.toThrow(RegistrationClosedError);
  });

  it('vrátí existující registraci při duplicitním volání', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([MOCK_CONFIG])
      .mockResolvedValueOnce([])   // INSERT → conflict → prázdné
      .mockResolvedValueOnce([{ id: 'reg_1', status: 'pending', registered_at: NOW }]);

    const result = await register(deps, 'user_1', 'evt_001', NOW);
    expect(result.id).toBe('reg_1');
  });

  it('pošle Kafka event po registraci', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([MOCK_CONFIG])
      .mockResolvedValueOnce([{ id: 'reg_1', status: 'pending', registered_at: NOW }]);

    await register(deps, 'user_1', 'evt_001', NOW);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'tixly.verified-fan.registered',
      expect.objectContaining({ eventId: 'evt_001', userId: 'user_1' }),
    );
  });
});

// ---------------------------------------------------------------------------
// runSelection()
// ---------------------------------------------------------------------------

describe('runSelection()', () => {
  it('vrátí správný počet vybraných fanů', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([MOCK_CONFIG])
      .mockResolvedValueOnce([{ total: 50 }]);   // celkem registrací

    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn().mockResolvedValueOnce([
        { id: 'reg_1', user_id: 'user_1' },
        { id: 'reg_2', user_id: 'user_2' },
      ]);
      return fn(tx);
    });

    const result = await runSelection(deps, 'evt_001', NOW);

    // selectedCount = Math.min(slots=10, total=50) = 10
    expect(result.selectedCount).toBe(10);
    expect(result.totalRegistrations).toBe(50);
    expect(result.method).toBe('random');
  });

  it('pošle email vybraným fanům', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([MOCK_CONFIG])
      .mockResolvedValueOnce([{ total: 5 }]);

    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn().mockResolvedValueOnce([
        { id: 'reg_1', user_id: 'user@example.com' },
      ]);
      return fn(tx);
    });

    await runSelection(deps, 'evt_001', NOW);

    expect(deps.email.send).toHaveBeenCalledWith(
      'user@example.com',
      expect.stringContaining('Presale'),
      expect.stringContaining('/cs/presale?token='),
    );
  });

  it('vyhodí chybu pokud config neexistuje', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([]);

    await expect(runSelection(deps, 'evt_neexistuje', NOW))
      .rejects.toThrow('Config pro akci evt_neexistuje nenalezen.');
  });

  it('pošle Kafka event po selekci', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([MOCK_CONFIG])
      .mockResolvedValueOnce([{ total: 3 }]);

    deps.db.transaction = vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = makeDb();
      tx.query = vi.fn().mockResolvedValueOnce([]);
      return fn(tx);
    });

    await runSelection(deps, 'evt_001', NOW);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'tixly.verified-fan.selection-complete',
      expect.objectContaining({ eventId: 'evt_001' }),
    );
  });
});

// ---------------------------------------------------------------------------
// redeemAccessLink()
// ---------------------------------------------------------------------------

describe('redeemAccessLink()', () => {
  it('vyhodí AccessLinkAlreadyUsedError pro použitý token', async () => {
    const deps = makeDeps();
    deps.redis.setNx = vi.fn().mockResolvedValue(false);

    // Potřebujeme platný token — mockujeme verifyAccessToken
    const { generateAccessToken } = await import('../src/lib/access-token');
    process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
    const { token } = await generateAccessToken(
      { registrationId: 'reg_1', eventId: 'evt_001', userId: 'user_1', presaleTicketTypeId: 'tt_1' },
      48,
    );

    await expect(redeemAccessLink(deps, token))
      .rejects.toThrow(AccessLinkAlreadyUsedError);
  });

  it('vyhodí AccessLinkExpiredError pro neplatný token', async () => {
    const deps = makeDeps();
    await expect(redeemAccessLink(deps, 'invalid.jwt.token'))
      .rejects.toThrow(AccessLinkExpiredError);
  });
});

// ---------------------------------------------------------------------------
// getRegistrationStatus()
// ---------------------------------------------------------------------------

describe('getRegistrationStatus()', () => {
  it('vrátí registraci pokud existuje', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([
      { id: 'reg_1', status: 'selected', registered_at: NOW },
    ]);

    const result = await getRegistrationStatus(deps, 'user_1', 'evt_001');
    expect(result?.status).toBe('selected');
  });

  it('vrátí null pokud fan není registrován', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([]);

    const result = await getRegistrationStatus(deps, 'user_1', 'evt_001');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listRegistrations()
// ---------------------------------------------------------------------------

describe('listRegistrations()', () => {
  it('vrátí správné počty per status', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([
      { status: 'pending', count: 90 },
      { status: 'selected', count: 10 },
      { status: 'not_selected', count: 80 },
      { status: 'link_used', count: 7 },
    ]);

    const result = await listRegistrations(deps, 'promoter_1', 'evt_001');
    expect(result.pending).toBe(90);
    expect(result.selected).toBe(10);
    expect(result.notSelected).toBe(80);
    expect(result.linkUsed).toBe(7);
  });

  it('vrátí nuly pro chybějící statusy', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([]);

    const result = await listRegistrations(deps, 'promoter_1', 'evt_001');
    expect(result.pending).toBe(0);
    expect(result.selected).toBe(0);
  });
});
