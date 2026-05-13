/**
 * Onfido service — unit tests
 *
 * Strategy:
 *   - db and kafka mocked via ServiceDeps
 *   - global.fetch spied for configured-mode HTTP assertions
 *   - Dev-mode path exercised by leaving ONFIDO_* env unset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

import {
  startOnfidoVerification,
  handleOnfidoWebhook,
  getOnfidoVerificationStatus,
  type ServiceDeps,
} from '../services/onfido.service.js';
import { IdentityError, IdentityErrorCode } from '../lib/identity-errors.js';
import { __resetOnfidoConfigWarning } from '../lib/onfido-config.js';

const TEST_KEY  = 'a'.repeat(64);
const TEST_SALT = 'unit-test-identity-salt-0123456789';
const WEBHOOK_SECRET = 'test-webhook-secret';

function buildDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  const db: ServiceDeps['db'] = {
    query:   vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  const redis: ServiceDeps['redis'] = {
    setex: vi.fn().mockResolvedValue(undefined),
    get:   vi.fn().mockResolvedValue(null),
    del:   vi.fn().mockResolvedValue(undefined),
  };
  return { db, redis, ...overrides };
}

function clearOnfidoEnv(): void {
  delete process.env.ONFIDO_API_KEY;
  delete process.env.ONFIDO_API_REGION;
  delete process.env.ONFIDO_WORKFLOW_ID;
  delete process.env.ONFIDO_WEBHOOK_TOKEN;
  __resetOnfidoConfigWarning();
}

function configureOnfido(): void {
  process.env.ONFIDO_API_KEY       = 'test-api-key';
  process.env.ONFIDO_API_REGION    = 'eu';
  process.env.ONFIDO_WORKFLOW_ID   = 'wf-1234';
  process.env.ONFIDO_WEBHOOK_TOKEN = WEBHOOK_SECRET;
  __resetOnfidoConfigWarning();
}

beforeEach(() => {
  process.env.IDENTITY_ENCRYPTION_KEY = TEST_KEY;
  process.env.IDENTITY_HASH_SALT      = TEST_SALT;
  clearOnfidoEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// startOnfidoVerification — dev mode
// ---------------------------------------------------------------------------

describe('startOnfidoVerification (dev mode)', () => {
  it('returns deterministic stubs without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const deps = buildDeps();

    const result = await startOnfidoVerification(
      'user-1',
      { firstName: 'Alice', lastName: 'Example', email: 'a@example.com' },
      'https://app.test',
      deps,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.applicantId).toMatch(/^dev-applicant-/);
    expect(result.sdkToken).toBe('dev-sdk-token');
    expect(result.workflowRunId).toMatch(/^dev-workflow-run-/);
    expect(deps.db.execute).toHaveBeenCalledTimes(1);
  });

  it('returns the existing verification when one already exists for the user', async () => {
    const deps = buildDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'row-1',
        user_id: 'user-1',
        applicant_id: 'applicant-existing',
        workflow_run_id: 'wfr-existing',
        status: 'pending',
        result: null,
        identity_hash: null,
      },
    ]);

    const result = await startOnfidoVerification(
      'user-1',
      { firstName: 'Alice', lastName: 'Example' },
      'https://app.test',
      deps,
    );

    expect(result.applicantId).toBe('applicant-existing');
    expect(result.workflowRunId).toBe('wfr-existing');
    expect(deps.db.execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// startOnfidoVerification — configured mode
// ---------------------------------------------------------------------------

describe('startOnfidoVerification (configured mode)', () => {
  beforeEach(() => configureOnfido());

  it('builds the correct request bodies and parses Onfido responses', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/applicants')) {
        return new Response(JSON.stringify({ id: 'app-real-1' }), { status: 200 });
      }
      if (url.endsWith('/sdk_token')) {
        return new Response(JSON.stringify({ token: 'sdk-real-1' }), { status: 200 });
      }
      if (url.endsWith('/workflow_runs')) {
        return new Response(
          JSON.stringify({ id: 'wfr-real-1', status: 'awaiting_input' }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const deps = buildDeps();
    const result = await startOnfidoVerification(
      'user-2',
      { firstName: 'Bob', lastName: 'Traveler', email: 'bob@example.com' },
      'https://app.test',
      deps,
    );

    expect(result).toEqual({
      applicantId: 'app-real-1',
      sdkToken: 'sdk-real-1',
      workflowRunId: 'wfr-real-1',
    });

    expect(calls[0].url).toBe('https://api.eu.onfido.com/v3.6/applicants');
    const applicantHeaders = calls[0].init.headers as Record<string, string>;
    expect(applicantHeaders.Authorization).toBe('Token token=test-api-key');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      first_name: 'Bob',
      last_name:  'Traveler',
      email:      'bob@example.com',
    });

    expect(calls[2].url).toBe('https://api.eu.onfido.com/v3.6/workflow_runs');
    expect(JSON.parse(calls[2].init.body as string)).toEqual({
      applicant_id: 'app-real-1',
      workflow_id:  'wf-1234',
    });

    expect(deps.db.execute).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// handleOnfidoWebhook
// ---------------------------------------------------------------------------

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

describe('handleOnfidoWebhook', () => {
  beforeEach(() => configureOnfido());

  it('rejects a webhook with an invalid signature', async () => {
    const deps = buildDeps();
    const body = JSON.stringify({
      payload: { action: 'workflow_run.completed', object: { id: 'wfr-1' } },
    });

    await expect(
      handleOnfidoWebhook(body, 'deadbeef', deps),
    ).rejects.toMatchObject({ code: IdentityErrorCode.ONFIDO_INVALID_WEBHOOK });
    expect(deps.db.execute).not.toHaveBeenCalled();
  });

  it('accepts a valid HMAC and updates the row as clear (with identityHash)', async () => {
    const deps = buildDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'row-1',
        user_id: 'user-1',
        applicant_id: 'app-1',
        workflow_run_id: 'wfr-1',
        status: 'pending',
        result: null,
        identity_hash: null,
      },
    ]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'wfr-1',
            status: 'approved',
            output: {
              document_number: 'X1234567',
              first_name: 'Alice',
              last_name: 'Example',
              date_of_birth: '1990-01-01',
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    );

    const body = JSON.stringify({
      payload: { action: 'workflow_run.completed', object: { id: 'wfr-1' } },
    });

    const res = await handleOnfidoWebhook(body, sign(body), deps);

    expect(res.processed).toBe(true);
    expect(res.verificationId).toBe('row-1');

    const execMock = deps.db.execute as ReturnType<typeof vi.fn>;
    expect(execMock).toHaveBeenCalledTimes(1);
    const [, params] = execMock.mock.calls[0];
    expect(params[0]).toBe('clear');
    expect(typeof params[1]).toBe('string');
    expect((params[1] as string).length).toBe(64); // sha256 hex
  });

  it('marks the row as consider (no identityHash) when workflow result is not clear', async () => {
    const deps = buildDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'row-2',
        user_id: 'user-2',
        applicant_id: 'app-2',
        workflow_run_id: 'wfr-2',
        status: 'pending',
        result: null,
        identity_hash: null,
      },
    ]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      vi.fn(async () =>
        new Response(
          JSON.stringify({ id: 'wfr-2', status: 'declined', output: {} }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch,
    );

    const body = JSON.stringify({
      payload: { action: 'workflow_run.completed', object: { id: 'wfr-2' } },
    });

    const res = await handleOnfidoWebhook(body, sign(body), deps);
    expect(res.processed).toBe(true);

    const execMock = deps.db.execute as ReturnType<typeof vi.fn>;
    const [, params] = execMock.mock.calls[0];
    expect(params[0]).toBe('consider');
    expect(params[1]).toBeNull();
  });

  it('is idempotent — duplicate webhook for the same workflow_run_id does not re-process', async () => {
    const deps = buildDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'row-3',
        user_id: 'user-3',
        applicant_id: 'app-3',
        workflow_run_id: 'wfr-3',
        status: 'completed', // already done
        result: 'clear',
        identity_hash: 'abc',
      },
    ]);

    const body = JSON.stringify({
      payload: { action: 'workflow_run.completed', object: { id: 'wfr-3' } },
    });

    const res = await handleOnfidoWebhook(body, sign(body), deps);
    expect(res.processed).toBe(false);
    expect(res.verificationId).toBe('row-3');
    expect(deps.db.execute).not.toHaveBeenCalled();
  });

  it('ignores unrelated actions', async () => {
    const deps = buildDeps();
    const body = JSON.stringify({
      payload: { action: 'check.completed', object: { id: 'chk-1' } },
    });
    const res = await handleOnfidoWebhook(body, sign(body), deps);
    expect(res.processed).toBe(false);
    expect(deps.db.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getOnfidoVerificationStatus
// ---------------------------------------------------------------------------

describe('getOnfidoVerificationStatus', () => {
  it('returns null when the user has no verification', async () => {
    const deps = buildDeps();
    const res = await getOnfidoVerificationStatus('user-x', deps);
    expect(res).toBeNull();
  });

  it('returns the latest row mapped to OnfidoVerificationResult', async () => {
    const deps = buildDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'row-9',
        user_id: 'user-9',
        applicant_id: 'app-9',
        workflow_run_id: 'wfr-9',
        status: 'completed',
        result: 'clear',
        identity_hash: 'hash-9',
      },
    ]);
    const res = await getOnfidoVerificationStatus('user-9', deps);
    expect(res).toEqual({
      applicantId: 'app-9',
      workflowRunId: 'wfr-9',
      status: 'completed',
      result: 'clear',
      identityHash: 'hash-9',
    });
  });
});

// ---------------------------------------------------------------------------
// IdentityError shape (sanity)
// ---------------------------------------------------------------------------

describe('Onfido error codes', () => {
  it('exposes the new codes on IdentityErrorCode', () => {
    expect(IdentityErrorCode.ONFIDO_NOT_CONFIGURED).toBe('ONFIDO_NOT_CONFIGURED');
    expect(IdentityErrorCode.ONFIDO_API_ERROR).toBe('ONFIDO_API_ERROR');
    expect(IdentityErrorCode.ONFIDO_INVALID_WEBHOOK).toBe('ONFIDO_INVALID_WEBHOOK');
    expect(IdentityErrorCode.ONFIDO_VERIFICATION_PENDING).toBe('ONFIDO_VERIFICATION_PENDING');
    expect(IdentityErrorCode.ONFIDO_VERIFICATION_FAILED).toBe('ONFIDO_VERIFICATION_FAILED');
    const err = new IdentityError(IdentityErrorCode.ONFIDO_API_ERROR, 'boom');
    expect(err.code).toBe('ONFIDO_API_ERROR');
  });
});
