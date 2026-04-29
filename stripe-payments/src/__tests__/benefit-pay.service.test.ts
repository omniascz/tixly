import { describe, it, expect, vi } from 'vitest';
import {
  initiateBenefitPayment,
  captureBenefitPayment,
  refundBenefitPayment,
  checkEmployeeBalance,
  getAvailableProviders,
  SUPPORTED_PROVIDERS,
} from '../services/benefit-pay.service.js';
import type { DbAdapter, BenefitProviderAdapter } from '../services/benefit-pay.service.js';

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-001',
    order_id: 'order-001',
    user_id: 'user-001',
    provider_id: 'benefit_plus',
    amount_hellers: 50000,
    currency: 'CZK',
    status: 'initiated',
    provider_session_id: null,
    provider_tx_id: null,
    employee_id: 'emp-001',
    error_code: null,
    error_message: null,
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    captured_at: null,
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
  };
}

function makeProvider(overrides: Partial<BenefitProviderAdapter> = {}): BenefitProviderAdapter {
  return {
    checkBalance: vi.fn(async () => ({ balanceCzk: 5000, category: 'culture' })),
    initiatePayment: vi.fn(async () => ({
      providerSessionId: 'prov-sess-001',
      authUrl: 'https://provider.example.com/auth/prov-sess-001',
    })),
    capturePayment: vi.fn(async () => ({
      providerTxId: 'prov-tx-001',
      capturedAmountHellers: 50000,
      status: 'success' as const,
    })),
    refundPayment: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('SUPPORTED_PROVIDERS', () => {
  it('obsahuje všechny 4 české poskytovatele', () => {
    expect(SUPPORTED_PROVIDERS).toContain('benefit_plus');
    expect(SUPPORTED_PROVIDERS).toContain('pluxee');
    expect(SUPPORTED_PROVIDERS).toContain('gallery_beta');
    expect(SUPPORTED_PROVIDERS).toContain('benefity');
    expect(SUPPORTED_PROVIDERS).toHaveLength(4);
  });
});

describe('initiateBenefitPayment', () => {
  it('vytvoří session a vrátí authUrl', async () => {
    const initiatedRow = makeSessionRow({ status: 'initiated' });
    const pendingRow = makeSessionRow({ status: 'pending_user_auth', provider_session_id: 'prov-sess-001' });
    const db = makeDb([[initiatedRow], [pendingRow]]);
    const provider = makeProvider();

    const result = await initiateBenefitPayment(
      'order-001', 'user-001', 'benefit_plus', 'emp-001', 50000,
      'Lístek na festival', 'https://app.example.com/callback',
      provider, db,
    );

    expect(result.authUrl).toBe('https://provider.example.com/auth/prov-sess-001');
    expect(result.session.status).toBe('pending_user_auth');
    expect(result.session.providerSessionId).toBe('prov-sess-001');
    expect(provider.initiatePayment).toHaveBeenCalledWith({
      employeeId: 'emp-001',
      amountHellers: 50000,
      orderId: 'order-001',
      description: 'Lístek na festival',
      callbackUrl: 'https://app.example.com/callback',
    });
  });

  it('odmítne nepodporovaného poskytovatele', async () => {
    const db = makeDb();
    const provider = makeProvider();
    await expect(
      initiateBenefitPayment('o', 'u', 'unknown_provider' as never, 'e', 100, 'd', 'cb', provider, db),
    ).rejects.toThrow('unsupported benefit provider');
  });

  it('odmítne nulovou nebo zápornou částku', async () => {
    const db = makeDb();
    const provider = makeProvider();
    await expect(
      initiateBenefitPayment('o', 'u', 'pluxee', 'emp-001', 0, 'd', 'cb', provider, db),
    ).rejects.toThrow('amount must be positive');
  });

  it('odmítne prázdné employeeId', async () => {
    const db = makeDb();
    const provider = makeProvider();
    await expect(
      initiateBenefitPayment('o', 'u', 'pluxee', '   ', 100, 'd', 'cb', provider, db),
    ).rejects.toThrow('employeeId is required');
  });

  it('při chybě poskytovatele nastaví session na failed', async () => {
    const initiatedRow = makeSessionRow();
    const db = makeDb([[initiatedRow]]);
    const provider = makeProvider({
      initiatePayment: vi.fn(async () => { throw new Error('PROVIDER_DOWN'); }),
    });

    await expect(
      initiateBenefitPayment('order-001', 'user-001', 'benefit_plus', 'emp-001', 50000, 'd', 'cb', provider, db),
    ).rejects.toThrow('PROVIDER_DOWN');

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'failed'"),
      expect.arrayContaining(['session-001']),
    );
  });
});

describe('captureBenefitPayment', () => {
  it('zachytí platbu a vrátí captured session', async () => {
    const pendingSession = makeSessionRow({
      status: 'pending_user_auth',
      provider_session_id: 'prov-sess-001',
    });
    const capturedSession = makeSessionRow({
      status: 'captured',
      provider_tx_id: 'prov-tx-001',
    });
    const db = makeDb([[pendingSession], [capturedSession]]);
    const provider = makeProvider();

    const result = await captureBenefitPayment('session-001', provider, db);
    expect(result.status).toBe('captured');
    expect(result.providerTxId).toBe('prov-tx-001');
  });

  it('vrátí failed session pokud poskytovatel odmítne', async () => {
    const pendingSession = makeSessionRow({
      status: 'pending_user_auth',
      provider_session_id: 'prov-sess-001',
    });
    const failedSession = makeSessionRow({ status: 'failed', error_code: 'INSUFFICIENT_BALANCE' });
    const db = makeDb([[pendingSession], [failedSession]]);
    const provider = makeProvider({
      capturePayment: vi.fn(async () => ({
        providerTxId: '',
        capturedAmountHellers: 0,
        status: 'failed' as const,
        errorCode: 'INSUFFICIENT_BALANCE',
      })),
    });

    const result = await captureBenefitPayment('session-001', provider, db);
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INSUFFICIENT_BALANCE');
  });

  it('vyhodí chybu pro nenalezenou session', async () => {
    const db = makeDb([[]]); // empty
    const provider = makeProvider();
    await expect(captureBenefitPayment('bad-id', provider, db)).rejects.toThrow('SESSION_NOT_FOUND');
  });

  it('vyhodí chybu pro nesprávný stav session', async () => {
    const paidSession = makeSessionRow({ status: 'captured' });
    const db = makeDb([[paidSession]]);
    const provider = makeProvider();
    await expect(captureBenefitPayment('session-001', provider, db)).rejects.toThrow('INVALID_STATE');
  });
});

describe('refundBenefitPayment', () => {
  it('vrátí platbu a nastaví stav na refunded', async () => {
    const capturedSession = makeSessionRow({
      status: 'captured',
      provider_tx_id: 'prov-tx-001',
    });
    const refundedSession = makeSessionRow({ status: 'refunded' });
    const db = makeDb([[capturedSession], [refundedSession]]);
    const provider = makeProvider();

    const result = await refundBenefitPayment('session-001', provider, db);
    expect(result.status).toBe('refunded');
    expect(provider.refundPayment).toHaveBeenCalledWith('prov-tx-001', 50000);
  });

  it('vyhodí chybu pokud session není captured', async () => {
    const db = makeDb([[]]); // not found
    const provider = makeProvider();
    await expect(refundBenefitPayment('session-001', provider, db)).rejects.toThrow('SESSION_NOT_FOUND');
  });
});

describe('checkEmployeeBalance', () => {
  it('vrátí zůstatek od poskytovatele', async () => {
    const provider = makeProvider();
    const result = await checkEmployeeBalance('emp-001', provider);
    expect(result).toEqual({ balanceCzk: 5000, category: 'culture' });
    expect(provider.checkBalance).toHaveBeenCalledWith('emp-001');
  });

  it('vrátí null pokud zaměstnanec nenalezen', async () => {
    const provider = makeProvider({
      checkBalance: vi.fn(async () => null),
    });
    const result = await checkEmployeeBalance('unknown', provider);
    expect(result).toBeNull();
  });
});

describe('getAvailableProviders', () => {
  it('vrátí seznam aktivních poskytovatelů', async () => {
    const db = makeDb([[
      { id: 'benefit_plus', name: 'Benefit Plus', logo_url: 'https://cdn.example.com/bp.png' },
      { id: 'pluxee', name: 'Pluxee', logo_url: null },
    ]]);
    const result = await getAvailableProviders(db);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'benefit_plus', name: 'Benefit Plus', logoUrl: 'https://cdn.example.com/bp.png' });
    expect(result[1].logoUrl).toBeNull();
  });
});
