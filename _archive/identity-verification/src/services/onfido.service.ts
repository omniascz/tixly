/**
 * Onfido identity verification service — alternative to BankID for
 * international customers who don't have a Czech BankID.
 *
 * Flow:
 *   1. Frontend calls POST /api/identity/onfido/start
 *      → we create Applicant, SdkToken and WorkflowRun in Onfido and persist
 *        a pending row in identity.onfido_verifications.
 *   2. Frontend uses the SDK token to upload documents + selfie directly to
 *      Onfido from the browser.
 *   3. Onfido POSTs to /api/identity/onfido/webhook when the workflow run
 *      completes. We verify HMAC and update the row with the final result.
 *   4. If the check comes back `clear` we compute an identityHash (reused by
 *      purchase-limit enforcement) from the document data.
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { hashIdentity } from '../lib/identity-crypto.js';
import { IdentityError, IdentityErrorCode } from '../lib/identity-errors.js';
import { loadOnfidoConfig, type OnfidoConfig } from '../lib/onfido-config.js';
import { OnfidoClient } from '../lib/onfido-client.js';
import type { IdentityDeps } from './bankid.service.js';

// The spec refers to `ServiceDeps` — we reuse the existing IdentityDeps shape.
export type ServiceDeps = IdentityDeps;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OnfidoVerificationResult {
  applicantId:    string;
  workflowRunId:  string;
  status:         'pending' | 'completed' | 'failed';
  result:         'clear' | 'consider' | null;
  /** Identity hash for purchase-limit enforcement (only set on success). */
  identityHash:   string | null;
}

interface OnfidoVerificationRow {
  id:               string;
  user_id:          string;
  applicant_id:     string;
  workflow_run_id:  string | null;
  status:           'pending' | 'completed' | 'failed';
  result:           'clear' | 'consider' | null;
  identity_hash:    string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfigOrThrow(): OnfidoConfig {
  const cfg = loadOnfidoConfig();
  // Dev-mode stub path is still allowed: !isConfigured paths through the
  // client return deterministic fixtures. Callers don't need to gate on it.
  return cfg;
}

function getHashSalt(): string {
  const salt = process.env.IDENTITY_HASH_SALT ?? '';
  if (salt.length < 16) {
    // Fall back to a deterministic dev salt so local runs don't explode.
    return 'dev-onfido-identity-salt-please-override';
  }
  return salt;
}

/** Verify HMAC-SHA256 hex signature sent in `X-SHA2-Signature` header. */
function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

// ---------------------------------------------------------------------------
// startOnfidoVerification
// ---------------------------------------------------------------------------

export async function startOnfidoVerification(
  userId: string,
  input: { firstName: string; lastName: string; email?: string },
  referrer: string,
  deps: ServiceDeps,
): Promise<{ applicantId: string; sdkToken: string; workflowRunId: string }> {
  const config = getConfigOrThrow();
  const client = new OnfidoClient(config, deps.fetch ?? globalThis.fetch);

  // 1. Existing verification? Return its identifiers (pending or active).
  const existing = await deps.db.query<OnfidoVerificationRow>(
    `SELECT id, user_id, applicant_id, workflow_run_id, status, result, identity_hash
       FROM identity.onfido_verifications
      WHERE user_id = $1
        AND (status = 'pending'
             OR (status = 'completed' AND result = 'clear'))
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );

  if (existing.length > 0 && existing[0].workflow_run_id) {
    // Mint a fresh SDK token bound to the new referrer — SDK tokens are
    // short-lived so we always reissue.
    const sdk = await client.createSdkToken(existing[0].applicant_id, referrer);
    return {
      applicantId:   existing[0].applicant_id,
      sdkToken:      sdk.token,
      workflowRunId: existing[0].workflow_run_id,
    };
  }

  // 2. Create applicant.
  const applicant = await client.createApplicant(input);

  // 3. Mint SDK token for browser-side uploads.
  const sdk = await client.createSdkToken(applicant.id, referrer);

  // 4. Start the verification workflow.
  const run = await client.createWorkflowRun(applicant.id);

  // 5. Persist pending row.
  await deps.db.execute(
    `INSERT INTO identity.onfido_verifications
       (user_id, applicant_id, workflow_run_id, status, created_at)
     VALUES ($1, $2, $3, 'pending', NOW())`,
    [userId, applicant.id, run.id],
  );

  return {
    applicantId:   applicant.id,
    sdkToken:      sdk.token,
    workflowRunId: run.id,
  };
}

// ---------------------------------------------------------------------------
// handleOnfidoWebhook
// ---------------------------------------------------------------------------

interface OnfidoWebhookPayload {
  payload?: {
    resource_type?: string;
    action?:        string;
    object?: {
      id?:            string;
      status?:        string;
      completed_at?:  string;
    };
  };
}

/**
 * Handle an Onfido webhook POST. The caller MUST pass the raw request body
 * string exactly as received — JSON re-serialization breaks HMAC validation.
 */
export async function handleOnfidoWebhook(
  payload: unknown,
  signature: string,
  deps: ServiceDeps,
): Promise<{ processed: boolean; verificationId: string | null }> {
  const config = getConfigOrThrow();

  // payload may arrive as a raw string (preferred — HMAC-safe) or an object.
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // 1. Verify HMAC signature.
  if (!verifyWebhookSignature(rawBody, signature, config.webhookToken)) {
    throw new IdentityError(
      IdentityErrorCode.ONFIDO_INVALID_WEBHOOK,
      'Neplatný podpis webhooku Onfido.',
    );
  }

  // 2. Parse.
  let parsed: OnfidoWebhookPayload;
  try {
    parsed = typeof payload === 'string'
      ? (JSON.parse(payload) as OnfidoWebhookPayload)
      : (payload as OnfidoWebhookPayload);
  } catch {
    throw new IdentityError(
      IdentityErrorCode.ONFIDO_INVALID_WEBHOOK,
      'Webhook Onfido obsahuje neplatný JSON.',
    );
  }

  const action          = parsed.payload?.action;
  const workflowRunId   = parsed.payload?.object?.id;

  if (action !== 'workflow_run.completed' || !workflowRunId) {
    // Unknown / irrelevant event — ack without processing.
    return { processed: false, verificationId: null };
  }

  // 3. Look up our pending row.
  const rows = await deps.db.query<OnfidoVerificationRow>(
    `SELECT id, user_id, applicant_id, workflow_run_id, status, result, identity_hash
       FROM identity.onfido_verifications
      WHERE workflow_run_id = $1
      LIMIT 1`,
    [workflowRunId],
  );

  if (rows.length === 0) {
    return { processed: false, verificationId: null };
  }

  const row = rows[0];

  // 4. Idempotency — already processed, skip.
  if (row.status !== 'pending') {
    return { processed: false, verificationId: row.id };
  }

  // 5. Fetch full workflow run details for document data.
  const client = new OnfidoClient(config, deps.fetch ?? globalThis.fetch);
  const run = await client.getWorkflowRun(workflowRunId);

  // 6. Extract document fields. Onfido workflows with a document check expose
  //    properties such as document_numbers, first_name, last_name, date_of_birth
  //    on the workflow output object.
  const output = (run.output ?? {}) as Record<string, unknown>;
  const docNumber =
    (output['document_number'] as string | undefined) ??
    (Array.isArray(output['document_numbers'])
      ? ((output['document_numbers'] as Array<{ value?: string }>)[0]?.value)
      : undefined) ??
    '';
  const firstName = (output['first_name']    as string | undefined) ?? '';
  const lastName  = (output['last_name']     as string | undefined) ?? '';
  const dob       = (output['date_of_birth'] as string | undefined) ?? '';

  // Onfido workflow-run status → our result mapping.
  //   approved → clear, declined/review → consider.
  const runStatus = (run.status ?? '').toLowerCase();
  const isClear   = runStatus === 'approved' || runStatus === 'clear';
  const finalResult: 'clear' | 'consider' = isClear ? 'clear' : 'consider';

  let identityHash: string | null = null;
  if (finalResult === 'clear') {
    const normalized = `${docNumber}|${firstName.toLowerCase()}|${lastName.toLowerCase()}|${dob}`;
    identityHash = hashIdentity(normalized || `onfido|${row.applicant_id}`, getHashSalt());
  }

  await deps.db.execute(
    `UPDATE identity.onfido_verifications
        SET status              = 'completed',
            result              = $1,
            identity_hash       = $2,
            raw_webhook_payload = $3::jsonb,
            completed_at        = NOW()
      WHERE id = $4
        AND status = 'pending'`,
    [finalResult, identityHash, rawBody, row.id],
  );

  // 7. Emit Kafka event (best-effort — deps may not carry a producer).
  const depsAny = deps as unknown as {
    kafka?: { produce: (topic: string, msg: unknown) => Promise<void> };
  };
  if (depsAny.kafka?.produce) {
    try {
      await depsAny.kafka.produce('identity.onfido.completed', {
        verificationId: row.id,
        userId:         row.user_id,
        applicantId:    row.applicant_id,
        workflowRunId,
        result:         finalResult,
        identityHash,
      });
    } catch {
      // swallow — webhook must still ack
    }
  }

  return { processed: true, verificationId: row.id };
}

// ---------------------------------------------------------------------------
// getOnfidoVerificationStatus
// ---------------------------------------------------------------------------

export async function getOnfidoVerificationStatus(
  userId: string,
  deps: ServiceDeps,
): Promise<OnfidoVerificationResult | null> {
  const rows = await deps.db.query<OnfidoVerificationRow>(
    `SELECT id, user_id, applicant_id, workflow_run_id, status, result, identity_hash
       FROM identity.onfido_verifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    applicantId:   row.applicant_id,
    workflowRunId: row.workflow_run_id ?? '',
    status:        row.status,
    result:        row.result,
    identityHash:  row.identity_hash,
  };
}

// Exported for tests only.
export const __internal = { verifyWebhookSignature };
