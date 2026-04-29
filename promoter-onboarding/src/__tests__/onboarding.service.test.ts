import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerUser,
  verifyEmail,
  resendVerificationEmail,
  createPromoterProfile,
  submitKyc,
  reviewKyc,
  getOnboardingStatus,
  adminListPendingKyc,
  setBcrypt,
} from '../services/onboarding.service';
import { OnboardingError, RateLimitError } from '../lib/onboarding-errors';
import type { ServiceDeps } from '../lib/service-container';
import type { RegisterUserInput, CreatePromoterProfileInput, SubmitKycInput, AdminKycReviewInput } from '../types/onboarding';

// ---------------------------------------------------------------------------
// Mock bcrypt so tests don't run actual hashing
// ---------------------------------------------------------------------------
setBcrypt({
  hash: vi.fn().mockResolvedValue('$2b$12$mockedhash'),
  compare: vi.fn().mockResolvedValue(true),
});

// ---------------------------------------------------------------------------
// Helper: build a minimal ServiceDeps mock
// ---------------------------------------------------------------------------
function makeDeps(overrides: Partial<{
  queryResults: Record<string, unknown[]>;
  executeCalls: string[];
}> = {}): ServiceDeps & {
  db: {
    query: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  redis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  kafka: { send: ReturnType<typeof vi.fn> };
  email: { send: ReturnType<typeof vi.fn> };
} {
  const queryMock = vi.fn();
  const executeMock = vi.fn().mockResolvedValue(undefined);
  const transactionMock = vi.fn().mockImplementation(async (fn: (tx: ServiceDeps['db']) => Promise<unknown>) => {
    return fn({
      query: queryMock,
      execute: executeMock,
      transaction: transactionMock,
    });
  });

  return {
    db: {
      query: queryMock,
      execute: executeMock,
      transaction: transactionMock,
    },
    redis: {
      setex: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(undefined),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(undefined),
    },
    kafka: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    email: {
      send: vi.fn().mockResolvedValue(undefined),
    },
  };
}

// ---------------------------------------------------------------------------
// registerUser
// ---------------------------------------------------------------------------
describe('registerUser', () => {
  const validInput: RegisterUserInput = {
    email: 'test@example.com',
    password: 'password123',
    firstName: 'Jan',
    lastName: 'Novák',
  };

  it('success: returns userId and sends verification email', async () => {
    const deps = makeDeps();
    // No existing user
    deps.db.query
      .mockResolvedValueOnce([])          // SELECT existing user
      .mockResolvedValueOnce([{ id: 'user-uuid-1' }]); // INSERT RETURNING id

    const result = await registerUser(validInput, deps);

    expect(result.userId).toBe('user-uuid-1');
    expect(deps.email.send).toHaveBeenCalledOnce();
    // email should be verification email
    const [to, subject] = deps.email.send.mock.calls[0];
    expect(to).toBe('test@example.com');
    expect(subject).toContain('potvrďte');
  });

  it('throws EMAIL_ALREADY_REGISTERED when email exists', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([{ id: 'existing-id' }]);

    await expect(registerUser(validInput, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'EMAIL_ALREADY_REGISTERED' }),
    );
  });

  it('emits Kafka user.registered event', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'user-uuid-2' }]);

    await registerUser(validInput, deps);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'user.registered',
      expect.objectContaining({ userId: 'user-uuid-2' }),
    );
  });
});

// ---------------------------------------------------------------------------
// verifyEmail
// ---------------------------------------------------------------------------
describe('verifyEmail', () => {
  const validToken = 'a'.repeat(64);

  it('success: returns userId and email', async () => {
    const deps = makeDeps();
    const futureDate = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    deps.db.query.mockResolvedValueOnce([
      { id: 'verif-id', user_id: 'user-1', email: 'user@example.com', is_used: false, expires_at: futureDate },
    ]);

    const result = await verifyEmail(validToken, deps);

    expect(result.userId).toBe('user-1');
    expect(result.email).toBe('user@example.com');
    expect(deps.db.execute).toHaveBeenCalledTimes(2); // mark used + update user
  });

  it('throws VERIFICATION_TOKEN_INVALID for missing token', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([]);

    await expect(verifyEmail(validToken, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VERIFICATION_TOKEN_INVALID' }),
    );
  });

  it('throws VERIFICATION_TOKEN_USED when is_used = true', async () => {
    const deps = makeDeps();
    const futureDate = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    deps.db.query.mockResolvedValueOnce([
      { id: 'verif-id', user_id: 'user-1', email: 'user@example.com', is_used: true, expires_at: futureDate },
    ]);

    await expect(verifyEmail(validToken, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VERIFICATION_TOKEN_USED' }),
    );
  });

  it('throws VERIFICATION_TOKEN_EXPIRED when past expiry', async () => {
    const deps = makeDeps();
    const pastDate = new Date(Date.now() - 1000).toISOString();
    deps.db.query.mockResolvedValueOnce([
      { id: 'verif-id', user_id: 'user-1', email: 'user@example.com', is_used: false, expires_at: pastDate },
    ]);

    await expect(verifyEmail(validToken, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'VERIFICATION_TOKEN_EXPIRED' }),
    );
  });

  it('emits Kafka user.email_verified event on success', async () => {
    const deps = makeDeps();
    const futureDate = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    deps.db.query.mockResolvedValueOnce([
      { id: 'verif-id', user_id: 'user-1', email: 'user@example.com', is_used: false, expires_at: futureDate },
    ]);

    await verifyEmail(validToken, deps);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'user.email_verified',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('throws RateLimitError after 10 verify attempts', async () => {
    const deps = makeDeps();
    const futureDate = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    // DB returns a valid (unconsumed) token record — rate limit fires before usage checks
    deps.db.query.mockResolvedValue([
      { id: 'verif-id', user_id: 'user-1', email: 'user@example.com', is_used: false, expires_at: futureDate },
    ]);
    // Simulate the 11th call: incr returns 11 (> 10 limit)
    deps.redis.incr.mockResolvedValue(11);

    await expect(verifyEmail(validToken, deps)).rejects.toThrow(RateLimitError);
    await expect(verifyEmail(validToken, deps)).rejects.toThrow(
      'Too many verification attempts. Try again in 60 seconds.',
    );
  });
});

// ---------------------------------------------------------------------------
// resendVerificationEmail
// ---------------------------------------------------------------------------
describe('resendVerificationEmail', () => {
  it('sends a new email and revokes old token', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([
      { id: 'user-1', email: 'user@example.com', email_verified: false },
    ]);
    deps.redis.get.mockResolvedValueOnce(null); // no rate limit

    await resendVerificationEmail('user-1', deps);

    // Should revoke + insert + send
    expect(deps.db.execute).toHaveBeenCalledTimes(2); // revoke + insert
    expect(deps.email.send).toHaveBeenCalledOnce();
  });

  it('silently returns when email already verified', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([
      { id: 'user-1', email: 'user@example.com', email_verified: true },
    ]);

    await resendVerificationEmail('user-1', deps);

    expect(deps.email.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createPromoterProfile
// ---------------------------------------------------------------------------
describe('createPromoterProfile', () => {
  const validInput: CreatePromoterProfileInput = {
    name: 'Acme Events',
    ico: '12345678',
    phone: '+420777888999',
  };

  it('success: creates promoter, member, and progress records', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([{ id: 'user-1', email: 'user@example.com', email_verified: true }]) // user
      .mockResolvedValueOnce([])                                                                    // no existing promoter
      .mockResolvedValueOnce([{ id: 'promoter-1' }]);                                              // INSERT promoter

    const result = await createPromoterProfile('user-1', validInput, deps);

    expect(result.promoterId).toBe('promoter-1');
    expect(deps.db.execute).toHaveBeenCalledTimes(2); // member + progress
    expect(deps.kafka.send).toHaveBeenCalledWith(
      'promoter.profile_created',
      expect.objectContaining({ promoterId: 'promoter-1' }),
    );
  });

  it('throws EMAIL_NOT_VERIFIED when email not verified', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([
      { id: 'user-1', email: 'user@example.com', email_verified: false },
    ]);

    await expect(createPromoterProfile('user-1', validInput, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
    );
  });

  it('throws PROMOTER_ALREADY_EXISTS when user already has a promoter', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([{ id: 'user-1', email: 'user@example.com', email_verified: true }])
      .mockResolvedValueOnce([{ promoter_id: 'existing-promoter' }]); // existing member

    await expect(createPromoterProfile('user-1', validInput, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'PROMOTER_ALREADY_EXISTS' }),
    );
  });

  it('throws INVALID_ICO for non-8-digit IČO', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([{ id: 'user-1', email: 'user@example.com', email_verified: true }])
      .mockResolvedValueOnce([]);

    const badInput: CreatePromoterProfileInput = { ...validInput, ico: '1234' };
    await expect(createPromoterProfile('user-1', badInput, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_ICO' }),
    );
  });
});

// ---------------------------------------------------------------------------
// submitKyc
// ---------------------------------------------------------------------------
describe('submitKyc', () => {
  const validInput: SubmitKycInput = {
    bankAccountIban: 'CZ6508000000192000145399',
    bankAccountSwift: 'KOMBCZPP',
    documents: [
      {
        documentType: 'business_registration',
        fileName: 'ico_cert.pdf',
        fileSize: 102400,
        storageKey: 's3://bucket/ico_cert.pdf',
        mimeType: 'application/pdf',
      },
    ],
  };

  it('success: KYC submitted, documents saved', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([{ promoter_id: 'promoter-1', role: 'owner' }]) // ownership check
      .mockResolvedValueOnce([{ id: 'promoter-1', name: 'Acme Events', kyc_status: 'not_started' }]) // promoter
      .mockResolvedValueOnce([{ email: 'owner@example.com' }]); // owner email

    await submitKyc('promoter-1', 'user-1', validInput, deps);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'promoter.kyc.submitted',
      expect.objectContaining({ promoterId: 'promoter-1' }),
    );
    // Two emails: admin + promoter
    expect(deps.email.send).toHaveBeenCalledTimes(2);
  });

  it('throws INVALID_IBAN for non-CZ IBAN', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([{ promoter_id: 'promoter-1', role: 'owner' }]);

    const badInput: SubmitKycInput = { ...validInput, bankAccountIban: 'DE89370400440532013000' };
    await expect(submitKyc('promoter-1', 'user-1', badInput, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_IBAN' }),
    );
  });

  it('throws KYC_ALREADY_SUBMITTED when kyc_status = submitted', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([{ promoter_id: 'promoter-1', role: 'owner' }])
      .mockResolvedValueOnce([{ id: 'promoter-1', name: 'Acme Events', kyc_status: 'submitted' }]);

    await expect(submitKyc('promoter-1', 'user-1', validInput, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'KYC_ALREADY_SUBMITTED' }),
    );
  });

  it('throws KYC_ALREADY_SUBMITTED when kyc_status = verified', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([{ promoter_id: 'promoter-1', role: 'owner' }])
      .mockResolvedValueOnce([{ id: 'promoter-1', name: 'Acme Events', kyc_status: 'verified' }]);

    await expect(submitKyc('promoter-1', 'user-1', validInput, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'KYC_ALREADY_SUBMITTED' }),
    );
  });
});

// ---------------------------------------------------------------------------
// reviewKyc
// ---------------------------------------------------------------------------
describe('reviewKyc', () => {
  function setupPromoterWithSubmittedKyc(deps: ReturnType<typeof makeDeps>, name = 'Acme Events') {
    deps.db.query
      .mockResolvedValueOnce([{ id: 'promoter-1', name, kyc_status: 'submitted' }]) // promoter
      .mockResolvedValueOnce([{ email: 'owner@example.com' }]);                      // owner email
  }

  it('approved: sets status=active, sends activation email, emits Kafka', async () => {
    const deps = makeDeps();
    setupPromoterWithSubmittedKyc(deps);
    const input: AdminKycReviewInput = { decision: 'approved' };

    await reviewKyc('promoter-1', 'admin-1', input, deps);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'promoter.activated',
      expect.objectContaining({ promoterId: 'promoter-1' }),
    );
    expect(deps.email.send).toHaveBeenCalledOnce();
    const [, subject] = deps.email.send.mock.calls[0];
    expect(subject).toContain('aktivován');
  });

  it('rejected without notes throws NOTES_REQUIRED', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([
      { id: 'promoter-1', name: 'Acme Events', kyc_status: 'submitted' },
    ]);
    const input: AdminKycReviewInput = { decision: 'rejected' };

    await expect(reviewKyc('promoter-1', 'admin-1', input, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'NOTES_REQUIRED' }),
    );
  });

  it('rejected with notes: updates kyc_status=rejected and sends email', async () => {
    const deps = makeDeps();
    setupPromoterWithSubmittedKyc(deps);
    const input: AdminKycReviewInput = {
      decision: 'rejected',
      notes: 'Chybí potvrzení od obchodního rejstříku',
    };

    await reviewKyc('promoter-1', 'admin-1', input, deps);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'promoter.kyc.rejected',
      expect.objectContaining({ promoterId: 'promoter-1' }),
    );
    expect(deps.email.send).toHaveBeenCalledOnce();
  });

  it('request_more_info: stores notes and sends info email', async () => {
    const deps = makeDeps();
    setupPromoterWithSubmittedKyc(deps);
    const input: AdminKycReviewInput = {
      decision: 'request_more_info',
      notes: 'Prosím přiložte výpis z banky za poslední 3 měsíce',
    };

    await reviewKyc('promoter-1', 'admin-1', input, deps);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'promoter.kyc.info_requested',
      expect.objectContaining({ promoterId: 'promoter-1' }),
    );
  });

  it('throws KYC_NOT_SUBMITTED when kyc_status != submitted', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([
      { id: 'promoter-1', name: 'Acme Events', kyc_status: 'not_started' },
    ]);
    const input: AdminKycReviewInput = { decision: 'approved' };

    await expect(reviewKyc('promoter-1', 'admin-1', input, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'KYC_NOT_SUBMITTED' }),
    );
  });

  it('request_more_info without notes throws NOTES_REQUIRED', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([
      { id: 'promoter-1', name: 'Acme Events', kyc_status: 'submitted' },
    ]);
    const input: AdminKycReviewInput = { decision: 'request_more_info' };

    await expect(reviewKyc('promoter-1', 'admin-1', input, deps)).rejects.toThrow(
      expect.objectContaining({ code: 'NOTES_REQUIRED' }),
    );
  });
});

// ---------------------------------------------------------------------------
// getOnboardingStatus
// ---------------------------------------------------------------------------
describe('getOnboardingStatus', () => {
  it('returns correct currentStep based on progress', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([
      {
        id: 'promoter-1',
        status: 'pending',
        kyc_status: 'submitted',
        kyc_rejection_notes: null,
        step_account: true,
        step_profile: true,
        step_kyc: true,
        step_activated: false,
        completed_at: null,
      },
    ]);

    const result = await getOnboardingStatus('promoter-1', deps);

    expect(result.currentStep).toBe('review');
    expect(result.steps.kyc).toBe(true);
    expect(result.steps.activated).toBe(false);
    expect(result.kycStatus).toBe('submitted');
  });

  it('returns currentStep=active when activated', async () => {
    const deps = makeDeps();
    const now = new Date().toISOString();
    deps.db.query.mockResolvedValueOnce([
      {
        id: 'promoter-1',
        status: 'active',
        kyc_status: 'verified',
        kyc_rejection_notes: null,
        step_account: true,
        step_profile: true,
        step_kyc: true,
        step_activated: true,
        completed_at: now,
      },
    ]);

    const result = await getOnboardingStatus('promoter-1', deps);

    expect(result.currentStep).toBe('active');
    expect(result.completedAt).toBe(now);
  });

  it('throws ONBOARDING_NOT_FOUND for unknown promoterId', async () => {
    const deps = makeDeps();
    deps.db.query.mockResolvedValueOnce([]);

    await expect(getOnboardingStatus('nonexistent', deps)).rejects.toThrow(
      expect.objectContaining({ code: 'ONBOARDING_NOT_FOUND' }),
    );
  });
});

// ---------------------------------------------------------------------------
// adminListPendingKyc
// ---------------------------------------------------------------------------
describe('adminListPendingKyc', () => {
  it('returns only kyc_status=submitted promoters', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([
        {
          id: 'promoter-1',
          name: 'Acme Events',
          ico: '12345678',
          kyc_submitted_at: '2026-04-01T10:00:00Z',
          document_count: '3',
        },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await adminListPendingKyc({ limit: 20, offset: 0 }, deps);

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].promoterId).toBe('promoter-1');
    expect(result.items[0].documentCount).toBe(3);
  });

  it('returns empty list when no pending KYC', async () => {
    const deps = makeDeps();
    deps.db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '0' }]);

    const result = await adminListPendingKyc({}, deps);

    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});
