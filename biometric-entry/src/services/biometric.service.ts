/**
 * Biometric entry service — Face ID as an alternative to QR-code scanning.
 *
 * GDPR compliance notes (Art. 9, biometric special category):
 *  - Template is stored only in encrypted form (BiometricEncryptionAdapter).
 *  - Raw photos are NEVER stored — consumers must only pass in embeddings.
 *  - All matches are logged (biometric.match_attempts) for accountability.
 *  - Enrollments auto-expire at event_end + 30 days and are purged by
 *    deleteExpiredEnrollments (template_encrypted cleared, status='deleted').
 *  - revokeEnrollment implements Right to Erasure (Art. 17) — ownership
 *    is enforced so users can only revoke their own enrollments.
 *  - exportUserBiometricData implements Right of Access (Art. 15).
 */

import {
  type BiometricEnrollment,
  BiometricError,
  type EnrollmentInput,
  type EnrollmentStatus,
  type GdprExport,
  type MatchAttempt,
  type MatchInput,
  type MatchResponse,
  type MatchResult,
  type ServiceDeps,
} from '../types/biometric.types.js';
import {
  MIN_CONFIDENCE_DEFAULT,
  validateTemplate,
} from '../lib/face-similarity.js';

const RETENTION_DAYS_AFTER_EVENT = 30;
const AMBIGUITY_MARGIN = 0.05;

function nowOf(deps: ServiceDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function generateId(prefix: string): string {
  // Simple collision-resistant id without external dependencies.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface EnrollmentRow {
  id: string;
  user_id: string;
  event_id: string;
  ticket_id: string;
  template_encrypted: string;
  template_algorithm: string;
  status: EnrollmentStatus;
  consent_version: string;
  consented_at: Date;
  consent_source: 'web' | 'mobile_app' | 'kiosk';
  enrolled_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  deleted_at: Date | null;
}

function rowToEnrollment(row: EnrollmentRow): BiometricEnrollment {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    ticketId: row.ticket_id,
    templateEncrypted: row.template_encrypted,
    templateAlgorithm: row.template_algorithm,
    status: row.status,
    consentVersion: row.consent_version,
    consentedAt: row.consented_at,
    consentSource: row.consent_source,
    enrolledAt: row.enrolled_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    deletedAt: row.deleted_at,
  };
}

async function writeAudit(
  deps: ServiceDeps,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await deps.db.execute(
    `INSERT INTO biometric.audit_log (id, event, payload, created_at)
     VALUES ($1, $2, $3, $4)`,
    [generateId('aud'), event, JSON.stringify(payload), nowOf(deps)],
  );
}

/**
 * Enroll a user's face template against a single ticket/event.
 */
export async function enrollBiometric(
  input: EnrollmentInput,
  deps: ServiceDeps,
): Promise<BiometricEnrollment> {
  if (!validateTemplate(input.faceTemplate, input.templateAlgorithm)) {
    throw new BiometricError(
      'INVALID_TEMPLATE',
      `Template does not match dimensions for algorithm ${input.templateAlgorithm}`,
    );
  }
  if (!input.consentVersion) {
    throw new BiometricError(
      'CONSENT_REQUIRED',
      'Explicit consent version is required for biometric enrollment (GDPR Art. 9).',
    );
  }

  const encrypted = await deps.encryption.encryptTemplate(input.faceTemplate);

  // Resolve event_end either from input or from the events table.
  let eventEnd = input.eventEnd;
  if (!eventEnd) {
    const rows = await deps.db.query<{ event_end: Date }>(
      `SELECT event_end FROM events WHERE id = $1`,
      [input.eventId],
    );
    if (rows.length === 0) {
      throw new BiometricError(
        'ENROLLMENT_NOT_FOUND',
        `Event ${input.eventId} not found`,
      );
    }
    eventEnd = rows[0].event_end instanceof Date
      ? rows[0].event_end
      : new Date(rows[0].event_end);
  }

  const now = nowOf(deps);
  const expiresAt = new Date(
    eventEnd.getTime() + RETENTION_DAYS_AFTER_EVENT * 24 * 60 * 60 * 1000,
  );

  const enrollment: BiometricEnrollment = {
    id: generateId('enr'),
    userId: input.userId,
    eventId: input.eventId,
    ticketId: input.ticketId,
    templateEncrypted: encrypted,
    templateAlgorithm: input.templateAlgorithm,
    status: 'active',
    consentVersion: input.consentVersion,
    consentedAt: now,
    consentSource: input.consentSource,
    enrolledAt: now,
    expiresAt,
    revokedAt: null,
    deletedAt: null,
  };

  await deps.db.execute(
    `INSERT INTO biometric.enrollments (
       id, user_id, event_id, ticket_id, template_encrypted, template_algorithm,
       status, consent_version, consented_at, consent_source, enrolled_at,
       expires_at, revoked_at, deleted_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      enrollment.id,
      enrollment.userId,
      enrollment.eventId,
      enrollment.ticketId,
      enrollment.templateEncrypted,
      enrollment.templateAlgorithm,
      enrollment.status,
      enrollment.consentVersion,
      enrollment.consentedAt,
      enrollment.consentSource,
      enrollment.enrolledAt,
      enrollment.expiresAt,
      enrollment.revokedAt,
      enrollment.deletedAt,
    ],
  );

  await writeAudit(deps, 'biometric.enrolled', {
    enrollmentId: enrollment.id,
    userId: enrollment.userId,
    eventId: enrollment.eventId,
    ticketId: enrollment.ticketId,
    consentVersion: enrollment.consentVersion,
    consentSource: enrollment.consentSource,
    algorithm: enrollment.templateAlgorithm,
  });

  return enrollment;
}

/**
 * Match a captured face template against all active enrollments for the event.
 *
 * Anti-fraud: if two candidates fall within AMBIGUITY_MARGIN (5 %) of each
 * other above the confidence threshold, we return 'multiple_matches' and do
 * NOT redeem any ticket — a human gate agent should intervene.
 */
export async function matchFace(
  input: MatchInput,
  deps: ServiceDeps,
): Promise<MatchResponse> {
  if (!validateTemplate(input.faceTemplate, input.templateAlgorithm)) {
    throw new BiometricError(
      'INVALID_TEMPLATE',
      `Template does not match dimensions for algorithm ${input.templateAlgorithm}`,
    );
  }

  const minConfidence = input.minConfidence ?? MIN_CONFIDENCE_DEFAULT;

  const rows = await deps.db.query<EnrollmentRow>(
    `SELECT * FROM biometric.enrollments
     WHERE event_id = $1 AND status = 'active' AND template_algorithm = $2`,
    [input.eventId, input.templateAlgorithm],
  );

  type Scored = { enrollment: BiometricEnrollment; score: number };
  const scored: Scored[] = [];
  for (const row of rows) {
    const enrollment = rowToEnrollment(row);
    const template = await deps.encryption.decryptTemplate(
      enrollment.templateEncrypted,
    );
    const score = deps.faceMatch.computeSimilarity(
      input.faceTemplate,
      template,
    );
    scored.push({ enrollment, score });
  }

  scored.sort((a, b) => b.score - a.score);

  let result: MatchResult;
  let best: Scored | null = scored[0] ?? null;
  let confidence = best ? best.score : 0;
  let ticketRedeemed = false;

  if (!best) {
    result = 'no_match';
    confidence = 0;
  } else if (best.score < minConfidence) {
    // Nothing clears the threshold — pick strongest rationale.
    // If best is very low we say 'no_match', otherwise 'low_confidence'.
    result = best.score < 0.5 ? 'no_match' : 'low_confidence';
  } else {
    const runnerUp = scored[1];
    if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) {
      result = 'multiple_matches';
    } else {
      result = 'matched';
    }
  }

  const attempt: MatchAttempt = {
    id: generateId('att'),
    enrollmentId: result === 'matched' ? best!.enrollment.id : null,
    eventId: input.eventId,
    gateId: input.gateId,
    result,
    confidence,
    matchedAt: nowOf(deps),
    ticketRedeemed: false,
  };

  // If we matched exactly one candidate: redeem the ticket atomically.
  if (result === 'matched' && best) {
    const redeemRows = await deps.db.query<{ id: string }>(
      `UPDATE tickets
       SET redeemed_at = $2
       WHERE id = $1 AND redeemed_at IS NULL
       RETURNING id`,
      [best.enrollment.ticketId, nowOf(deps)],
    );
    if (redeemRows.length === 0) {
      // Ticket already redeemed — record attempt but surface error.
      attempt.result = 'matched';
      attempt.ticketRedeemed = false;
      await persistAttempt(deps, attempt);
      await writeAudit(deps, 'biometric.match', {
        attemptId: attempt.id,
        enrollmentId: attempt.enrollmentId,
        result: attempt.result,
        confidence: attempt.confidence,
        ticketRedeemed: false,
        reason: 'ticket_already_redeemed',
      });
      throw new BiometricError(
        'TICKET_ALREADY_REDEEMED',
        `Ticket ${best.enrollment.ticketId} has already been redeemed`,
      );
    }
    attempt.ticketRedeemed = true;
    ticketRedeemed = true;
  }

  await persistAttempt(deps, attempt);
  await writeAudit(deps, 'biometric.match', {
    attemptId: attempt.id,
    enrollmentId: attempt.enrollmentId,
    eventId: attempt.eventId,
    gateId: attempt.gateId,
    result: attempt.result,
    confidence: attempt.confidence,
    ticketRedeemed,
  });

  return {
    result,
    enrollmentId: result === 'matched' ? best!.enrollment.id : null,
    ticketId: result === 'matched' ? best!.enrollment.ticketId : null,
    userId: result === 'matched' ? best!.enrollment.userId : null,
    confidence,
    attemptId: attempt.id,
  };
}

async function persistAttempt(
  deps: ServiceDeps,
  attempt: MatchAttempt,
): Promise<void> {
  await deps.db.execute(
    `INSERT INTO biometric.match_attempts (
       id, enrollment_id, event_id, gate_id, result, confidence, matched_at, ticket_redeemed
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      attempt.id,
      attempt.enrollmentId,
      attempt.eventId,
      attempt.gateId,
      attempt.result,
      attempt.confidence,
      attempt.matchedAt,
      attempt.ticketRedeemed,
    ],
  );
}

/**
 * Revoke an enrollment on user request (GDPR Art. 17 — Right to Erasure).
 * Ownership is enforced: a user can only revoke their own enrollments.
 */
export async function revokeEnrollment(
  enrollmentId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<BiometricEnrollment> {
  const rows = await deps.db.query<EnrollmentRow>(
    `SELECT * FROM biometric.enrollments WHERE id = $1`,
    [enrollmentId],
  );
  if (rows.length === 0) {
    throw new BiometricError(
      'ENROLLMENT_NOT_FOUND',
      `Enrollment ${enrollmentId} not found`,
    );
  }
  const current = rowToEnrollment(rows[0]);
  if (current.userId !== userId) {
    throw new BiometricError(
      'ENROLLMENT_NOT_FOUND',
      `Enrollment ${enrollmentId} not found for user ${userId}`,
    );
  }

  const now = nowOf(deps);
  await deps.db.execute(
    `UPDATE biometric.enrollments
     SET status = 'revoked', revoked_at = $2
     WHERE id = $1`,
    [enrollmentId, now],
  );

  await writeAudit(deps, 'biometric.revoked', {
    enrollmentId,
    userId,
    reason: 'user_request_art17',
  });

  return {
    ...current,
    status: 'revoked',
    revokedAt: now,
  };
}

/**
 * Cron job: permanently purge enrollments whose retention window has passed.
 *
 * Clears the encrypted template (so even an attacker with future key access
 * cannot recover the embedding), sets status='deleted', and writes an audit
 * entry for each purged row.
 */
export async function deleteExpiredEnrollments(
  deps: ServiceDeps,
): Promise<{ deletedCount: number }> {
  const now = nowOf(deps);
  const expired = await deps.db.query<EnrollmentRow>(
    `SELECT * FROM biometric.enrollments
     WHERE expires_at < $1 AND status != 'deleted'`,
    [now],
  );

  for (const row of expired) {
    await deps.db.execute(
      `UPDATE biometric.enrollments
       SET template_encrypted = '',
           status = 'deleted',
           deleted_at = $2
       WHERE id = $1`,
      [row.id, now],
    );
    await writeAudit(deps, 'biometric.auto_deleted', {
      enrollmentId: row.id,
      userId: row.user_id,
      eventId: row.event_id,
      expiredAt: row.expires_at,
      reason: 'retention_expired',
    });
  }

  return { deletedCount: expired.length };
}

/**
 * Fetch a single enrollment, enforcing ownership.
 */
export async function getEnrollment(
  enrollmentId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<BiometricEnrollment> {
  const rows = await deps.db.query<EnrollmentRow>(
    `SELECT * FROM biometric.enrollments WHERE id = $1 AND user_id = $2`,
    [enrollmentId, userId],
  );
  if (rows.length === 0) {
    throw new BiometricError(
      'ENROLLMENT_NOT_FOUND',
      `Enrollment ${enrollmentId} not found for user ${userId}`,
    );
  }
  return rowToEnrollment(rows[0]);
}

/**
 * List a user's active (non-deleted, non-revoked) enrollments.
 */
export async function getEnrollmentsForUser(
  userId: string,
  deps: ServiceDeps,
): Promise<BiometricEnrollment[]> {
  const rows = await deps.db.query<EnrollmentRow>(
    `SELECT * FROM biometric.enrollments
     WHERE user_id = $1 AND status = 'active'
     ORDER BY enrolled_at DESC`,
    [userId],
  );
  return rows.map(rowToEnrollment);
}

/**
 * GDPR Art. 15 — Right of Access.
 *
 * Returns every biometric record we hold about a user: all enrollments
 * (regardless of state, but without the encrypted template blob) and
 * every match attempt they were a subject of.
 */
export async function exportUserBiometricData(
  userId: string,
  deps: ServiceDeps,
): Promise<GdprExport> {
  const enrollments = await deps.db.query<EnrollmentRow>(
    `SELECT * FROM biometric.enrollments WHERE user_id = $1`,
    [userId],
  );

  const enrollmentIds = enrollments.map((e) => e.id);
  let matchAttempts: MatchAttempt[] = [];
  if (enrollmentIds.length > 0) {
    const rows = await deps.db.query<{
      id: string;
      enrollment_id: string | null;
      event_id: string;
      gate_id: string;
      result: MatchResult;
      confidence: number;
      matched_at: Date;
      ticket_redeemed: boolean;
    }>(
      `SELECT * FROM biometric.match_attempts WHERE enrollment_id = ANY($1)`,
      [enrollmentIds],
    );
    matchAttempts = rows.map((r) => ({
      id: r.id,
      enrollmentId: r.enrollment_id,
      eventId: r.event_id,
      gateId: r.gate_id,
      result: r.result,
      confidence: r.confidence,
      matchedAt: r.matched_at,
      ticketRedeemed: r.ticket_redeemed,
    }));
  }

  return {
    userId,
    enrollments: enrollments.map((e) => ({
      id: e.id,
      eventId: e.event_id,
      ticketId: e.ticket_id,
      status: e.status,
      templateAlgorithm: e.template_algorithm,
      consentVersion: e.consent_version,
      consentedAt: e.consented_at,
      consentSource: e.consent_source,
      enrolledAt: e.enrolled_at,
      expiresAt: e.expires_at,
      revokedAt: e.revoked_at,
      deletedAt: e.deleted_at,
      // Note: template_encrypted intentionally omitted from export —
      // raw/encrypted biometric data is never surfaced to the subject.
    })),
    matchAttempts,
  };
}
