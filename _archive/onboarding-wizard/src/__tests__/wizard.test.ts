import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateEventBasics,
  validateTicketTypes,
  validatePaymentSetup,
  validateEventDetails,
  validateStep,
} from '../services/wizard-validator.service.js';
import { submitStep, goBackStep, skipStep } from '../services/wizard-steps.service.js';
import {
  createWizardSession,
  getWizardSession,
  publishEvent,
  getWizardProgress,
  cleanupExpiredSessions,
} from '../services/wizard.service.js';
import type { DbAdapter, WizardSession, WizardStep, WizardData } from '../lib/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      return fn(makeMockDb(overrides));
    }),
    ...overrides,
  };
}

function futureDate(daysFromNow = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

function pastDate(daysAgo = 1): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function makeSession(overrides: Partial<WizardSession> = {}): WizardSession {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return {
    id: 'session-1',
    promoterId: 'promoter-1',
    currentStep: 'event_basics',
    completedSteps: [],
    data: {},
    status: 'in_progress',
    createdAt: now,
    updatedAt: now,
    expiresAt: expires,
    ...overrides,
  };
}

function makeSessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return {
    id: 'session-1',
    promoter_id: 'promoter-1',
    current_step: 'event_basics',
    completed_steps: [],
    data: {},
    status: 'in_progress',
    created_at: now,
    updated_at: now,
    expires_at: expires,
    ...overrides,
  };
}

// ─── validateEventBasics ──────────────────────────────────────────────────────

describe('validateEventBasics', () => {
  it('1. valid data → prázdný objekt errors', () => {
    const errors = validateEventBasics({
      eventName: 'Rock festival 2026',
      eventDate: futureDate(),
      capacity: 500,
      isOnline: false,
      venueName: 'O2 Arena Praha',
    });
    expect(errors).toEqual({});
  });

  it('2. missing eventName → error na eventName', () => {
    const errors = validateEventBasics({
      eventDate: futureDate(),
      capacity: 100,
      venueName: 'Venue',
    });
    expect(errors).toHaveProperty('eventName');
  });

  it('3. eventDate v minulosti → error na eventDate', () => {
    const errors = validateEventBasics({
      eventName: 'Test Event',
      eventDate: pastDate(5),
      capacity: 100,
      venueName: 'Venue',
    });
    expect(errors).toHaveProperty('eventDate');
  });

  it('4. capacity = 0 → error', () => {
    const errors = validateEventBasics({
      eventName: 'Test Event',
      eventDate: futureDate(),
      capacity: 0,
      venueName: 'Venue',
    });
    expect(errors).toHaveProperty('capacity');
  });

  it('5. capacity > 100000 → error', () => {
    const errors = validateEventBasics({
      eventName: 'Test Event',
      eventDate: futureDate(),
      capacity: 100001,
      venueName: 'Venue',
    });
    expect(errors).toHaveProperty('capacity');
  });

  it('6. isOnline=false + missing venueName → error', () => {
    const errors = validateEventBasics({
      eventName: 'Test Event',
      eventDate: futureDate(),
      capacity: 100,
      isOnline: false,
    });
    expect(errors).toHaveProperty('venueName');
  });

  it('7. isOnline=true + missing venueName → OK (online nepotřebuje venue)', () => {
    const errors = validateEventBasics({
      eventName: 'Online Workshop',
      eventDate: futureDate(),
      capacity: 100,
      isOnline: true,
    });
    expect(errors).not.toHaveProperty('venueName');
    expect(Object.keys(errors)).toHaveLength(0);
  });
});

// ─── validateTicketTypes ──────────────────────────────────────────────────────

describe('validateTicketTypes', () => {
  it('8. valid ticket types → OK', () => {
    const errors = validateTicketTypes({
      ticketTypes: [{ name: 'VIP', priceHalire: 50000, quantity: 100 }],
    });
    expect(errors).toEqual({});
  });

  it('9. prázdné pole → error', () => {
    const errors = validateTicketTypes({ ticketTypes: [] });
    expect(errors).toHaveProperty('ticketTypes');
  });

  it('10. ticket s priceHalire < 0 → error', () => {
    const errors = validateTicketTypes({
      ticketTypes: [{ name: 'Vstup', priceHalire: -1, quantity: 50 }],
    });
    expect(errors).toHaveProperty('ticketTypes[0].priceHalire');
  });

  it('11. ticket s quantity = 0 → error', () => {
    const errors = validateTicketTypes({
      ticketTypes: [{ name: 'Vstup', priceHalire: 200, quantity: 0 }],
    });
    expect(errors).toHaveProperty('ticketTypes[0].quantity');
  });

  it('12. salesEnd před salesStart → error', () => {
    const errors = validateTicketTypes({
      ticketTypes: [
        {
          name: 'Early Bird',
          priceHalire: 10000,
          quantity: 200,
          salesStart: futureDate(10),
          salesEnd: futureDate(5),
        },
      ],
    });
    expect(errors).toHaveProperty('ticketTypes[0].salesEnd');
  });
});

// ─── validatePaymentSetup ─────────────────────────────────────────────────────

describe('validatePaymentSetup', () => {
  it('13. valid payment methods → OK', () => {
    const errors = validatePaymentSetup({ paymentMethods: ['gopay', 'stripe'] });
    expect(errors).toEqual({});
  });

  it('14. prázdné payment methods → error', () => {
    const errors = validatePaymentSetup({ paymentMethods: [] });
    expect(errors).toHaveProperty('paymentMethods');
  });

  it('15. payoutBankAccount příliš krátký → error', () => {
    const errors = validatePaymentSetup({
      paymentMethods: ['gopay'],
      payoutBankAccount: '12345678',
    });
    expect(errors).toHaveProperty('payoutBankAccount');
  });
});

// ─── validateEventDetails ─────────────────────────────────────────────────────

describe('validateEventDetails', () => {
  it('16. missing category → error', () => {
    const errors = validateEventDetails({ description: 'Skvělý popis akce pro všechny.' });
    expect(errors).toHaveProperty('category');
  });

  it('17. description < 10 znaků → error', () => {
    const errors = validateEventDetails({ category: 'Hudba', description: 'Krátký' });
    expect(errors).toHaveProperty('description');
  });

  it('18. description undefined → OK (nepovinné)', () => {
    const errors = validateEventDetails({ category: 'Sport' });
    expect(errors).toEqual({});
  });
});

// ─── validateStep dispatcher ──────────────────────────────────────────────────

describe('validateStep dispatcher', () => {
  it('19. volá správný validator pro každý step', () => {
    // event_basics — missing eventName
    const e1 = validateStep('event_basics', { eventDate: futureDate(), capacity: 100, venueName: 'Venue' });
    expect(e1).toHaveProperty('eventName');

    // ticket_types — empty array
    const e2 = validateStep('ticket_types', { ticketTypes: [] });
    expect(e2).toHaveProperty('ticketTypes');

    // payment_setup — empty methods
    const e3 = validateStep('payment_setup', { paymentMethods: [] });
    expect(e3).toHaveProperty('paymentMethods');

    // event_details — missing category
    const e4 = validateStep('event_details', {});
    expect(e4).toHaveProperty('category');

    // review_publish — no validation
    const e5 = validateStep('review_publish', {});
    expect(e5).toEqual({});
  });
});

// ─── createWizardSession ──────────────────────────────────────────────────────

describe('createWizardSession', () => {
  it('20. vytvoří session s currentStep=event_basics, status=in_progress', async () => {
    const row = makeSessionRow();
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([row]),
    });

    const session = await createWizardSession('promoter-1', db);

    expect(session.currentStep).toBe('event_basics');
    expect(session.status).toBe('in_progress');
    expect(session.promoterId).toBe('promoter-1');
    expect(session.completedSteps).toEqual([]);
  });

  it('21. session expiruje za 24 hodin', async () => {
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const row = makeSessionRow({ expires_at: expires });
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([row]),
    });

    const session = await createWizardSession('promoter-1', db);

    const expiresAt = new Date(session.expiresAt);
    const now = new Date();
    const diffHours = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(23);
    expect(diffHours).toBeLessThanOrEqual(24);
  });
});

// ─── getWizardSession ─────────────────────────────────────────────────────────

describe('getWizardSession', () => {
  it('22. vrátí session pro správného promotéra', async () => {
    const row = makeSessionRow();
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const session = await getWizardSession('session-1', 'promoter-1', db);
    expect(session.id).toBe('session-1');
    expect(session.promoterId).toBe('promoter-1');
  });

  it('23. hodí error pro cizího promotéra (tenant isolation)', async () => {
    const row = makeSessionRow({ promoter_id: 'promoter-1' });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    await expect(getWizardSession('session-1', 'promoter-EVIL', db)).rejects.toThrow(
      /Přístup odepřen/,
    );
  });

  it('24. hodí error pro expirovanou session', async () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    const row = makeSessionRow({ expires_at: expired });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    await expect(getWizardSession('session-1', 'promoter-1', db)).rejects.toThrow(/expirovala/);
  });
});

// ─── submitStep ───────────────────────────────────────────────────────────────

describe('submitStep', () => {
  it('25. uloží data a postoupí na nextStep', async () => {
    const row = makeSessionRow({ current_step: 'event_basics', completed_steps: [] });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const result = await submitStep(
      'session-1',
      {
        step: 'event_basics',
        data: {
          eventName: 'Festival 2026',
          eventDate: futureDate(),
          capacity: 1000,
          isOnline: false,
          venueName: 'O2 Arena',
        },
      },
      db,
    );

    expect(result.currentStep).toBe('ticket_types');
    expect(result.completedSteps).toContain('event_basics');
    expect(result.errors).toBeUndefined();
  });

  it('26. vrátí errors pokud validace selže (step se neposune)', async () => {
    const row = makeSessionRow({ current_step: 'event_basics', completed_steps: [] });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const result = await submitStep(
      'session-1',
      {
        step: 'event_basics',
        data: {
          // missing eventName, invalid date, missing capacity, missing venueName
          eventDate: pastDate(5),
        },
      },
      db,
    );

    expect(result.currentStep).toBe('event_basics');
    expect(result.errors).toBeDefined();
    expect(Object.keys(result.errors ?? {})).toContain('eventName');
  });

  it('27. po posledním kroku nextStep=null', async () => {
    const allSteps: WizardStep[] = ['event_basics', 'ticket_types', 'payment_setup', 'event_details'];
    const row = makeSessionRow({
      current_step: 'review_publish',
      completed_steps: allSteps,
    });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const result = await submitStep(
      'session-1',
      { step: 'review_publish', data: {} },
      db,
    );

    expect(result.nextStep).toBeNull();
  });
});

// ─── goBackStep ───────────────────────────────────────────────────────────────

describe('goBackStep', () => {
  it('28. vrátí se na předchozí krok, data se neztrácejí', async () => {
    const existingData: WizardData = {
      eventName: 'Festival',
      eventDate: futureDate(),
      capacity: 500,
      venueName: 'Arena',
    };
    const row = makeSessionRow({
      current_step: 'ticket_types',
      completed_steps: ['event_basics'],
      data: existingData,
    });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const result = await goBackStep('session-1', db);

    expect(result.currentStep).toBe('event_basics');
    // Data are preserved in DB — execute was called but data not lost
    expect(db.execute).toHaveBeenCalled();
    // completedSteps still contains event_basics
    expect(result.completedSteps).toContain('event_basics');
  });
});

// ─── skipStep ─────────────────────────────────────────────────────────────────

describe('skipStep', () => {
  it('29. přeskočí přeskočitelný krok (payment_setup nebo event_details)', async () => {
    const row = makeSessionRow({
      current_step: 'payment_setup',
      completed_steps: ['event_basics', 'ticket_types'],
    });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    const result = await skipStep('session-1', db);

    expect(result.currentStep).toBe('event_details');
  });

  it('30. nedovolí přeskočit povinný krok (event_basics, ticket_types, review_publish)', async () => {
    const row = makeSessionRow({ current_step: 'event_basics', completed_steps: [] });
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([row]) });

    await expect(skipStep('session-1', db)).rejects.toThrow(/nelze přeskočit/i);
  });
});

// ─── publishEvent ─────────────────────────────────────────────────────────────

describe('publishEvent', () => {
  function makePublishSession(): Record<string, unknown> {
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return {
      id: 'session-pub',
      promoter_id: 'promoter-1',
      current_step: 'review_publish',
      completed_steps: ['event_basics', 'ticket_types', 'payment_setup', 'event_details'],
      data: {
        eventName: 'Big Concert',
        eventDate: futureDate(60),
        capacity: 5000,
        venueName: 'Forum Karlín',
        ticketTypes: [
          { name: 'Standard', priceHalire: 49900, quantity: 4000 },
          { name: 'VIP', priceHalire: 149900, quantity: 1000 },
        ],
        category: 'Hudba',
        description: 'Skvělý koncert pro všechny.',
        paymentMethods: ['gopay'],
      },
      status: 'in_progress',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: expires,
    };
  }

  it('31. vytvoří event a ticket types v DB transakcí', async () => {
    const sessionRow = makePublishSession();
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([sessionRow]),
    });

    await publishEvent('session-pub', 'promoter-1', db);

    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('32. vrátí PublishResult s eventId a ticketTypesCreated', async () => {
    const sessionRow = makePublishSession();

    // We need a real transaction that actually calls the fn
    let capturedExecute = vi.fn().mockResolvedValue(undefined);
    const db: DbAdapter = {
      query: vi.fn().mockResolvedValue([sessionRow]),
      execute: capturedExecute,
      transaction: vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
        const tx: DbAdapter = {
          query: vi.fn().mockResolvedValue([]),
          execute: capturedExecute,
          transaction: vi.fn(),
        };
        return fn(tx);
      }),
    };

    const result = await publishEvent('session-pub', 'promoter-1', db);

    expect(result.eventId).toBeTypeOf('string');
    expect(result.eventUrl).toContain(result.eventId);
    expect(result.ticketTypesCreated).toBe(2);
  });

  it('33. hodí error pokud wizard není na posledním kroku', async () => {
    const sessionRow = makePublishSession();
    // Override current_step to a non-final step
    (sessionRow as Record<string, unknown>)['current_step'] = 'ticket_types';
    const db = makeMockDb({ query: vi.fn().mockResolvedValue([sessionRow]) });

    await expect(publishEvent('session-pub', 'promoter-1', db)).rejects.toThrow(
      /Nelze publikovat/,
    );
  });
});

// ─── getWizardProgress ────────────────────────────────────────────────────────

describe('getWizardProgress', () => {
  it('34. 0% pro novou session', () => {
    const session = makeSession({ completedSteps: [], currentStep: 'event_basics' });
    const { percent } = getWizardProgress(session);
    expect(percent).toBe(0);
  });

  it('35. 100% po všech krocích', () => {
    const allSteps: WizardStep[] = [
      'event_basics',
      'ticket_types',
      'payment_setup',
      'event_details',
      'review_publish',
    ];
    const session = makeSession({
      completedSteps: allSteps,
      currentStep: 'review_publish',
    });
    const { percent, steps } = getWizardProgress(session);
    expect(percent).toBe(100);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
  });
});

// ─── cleanupExpiredSessions ───────────────────────────────────────────────────

describe('cleanupExpiredSessions', () => {
  it('36. vrátí počet smazaných sessions', async () => {
    const db = makeMockDb({
      query: vi.fn().mockResolvedValue([{ count: '3' }]),
    });

    const count = await cleanupExpiredSessions(db);

    expect(count).toBe(3);
    expect(db.execute).toHaveBeenCalledOnce();
  });
});
