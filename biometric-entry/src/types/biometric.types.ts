/**
 * Type definitions for the biometric-entry module.
 *
 * GDPR Art. 9 (special categories of personal data — biometric data):
 *  - Explicit opt-in consent required.
 *  - We store only an encrypted face template (embedding vector), never
 *    raw photos.
 *  - Encryption at rest via BiometricEncryptionAdapter.
 *  - Auto-deletion after event_end + 30 days.
 *  - Right to erasure (Art. 17) via revokeEnrollment.
 *  - All match attempts are written to an audit log for accountability.
 */

export type EnrollmentStatus =
  | 'pending_consent'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'deleted';

export type MatchResult =
  | 'matched'
  | 'no_match'
  | 'low_confidence'
  | 'multiple_matches';

export type ConsentSource = 'web' | 'mobile_app' | 'kiosk';

export interface BiometricEnrollment {
  id: string;
  userId: string;
  eventId: string;
  ticketId: string;
  templateEncrypted: string;
  templateAlgorithm: string;
  status: EnrollmentStatus;
  consentVersion: string;
  consentedAt: Date;
  consentSource: ConsentSource;
  enrolledAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  deletedAt: Date | null;
}

export interface MatchAttempt {
  id: string;
  enrollmentId: string | null;
  eventId: string;
  gateId: string;
  result: MatchResult;
  confidence: number;
  matchedAt: Date;
  ticketRedeemed: boolean;
}

export interface EnrollmentInput {
  userId: string;
  eventId: string;
  ticketId: string;
  faceTemplate: number[];
  templateAlgorithm: string;
  consentVersion: string;
  consentSource: ConsentSource;
  /**
   * Optional explicit event end date. If omitted, the service will read
   * the event end date from the database (events table).
   */
  eventEnd?: Date;
}

export interface MatchInput {
  eventId: string;
  gateId: string;
  faceTemplate: number[];
  templateAlgorithm: string;
  minConfidence?: number;
}

export interface MatchResponse {
  result: MatchResult;
  enrollmentId: string | null;
  ticketId: string | null;
  userId: string | null;
  confidence: number;
  attemptId: string;
}

export interface BiometricEncryptionAdapter {
  /** Encrypts a float[] template and returns a base64 string. */
  encryptTemplate(template: number[]): Promise<string>;
  /** Decrypts a base64 string back to a float[] template. */
  decryptTemplate(encrypted: string): Promise<number[]>;
}

export interface FaceMatchAdapter {
  /** Returns cosine similarity (0..1) between two templates. */
  computeSimilarity(a: number[], b: number[]): number;
}

export type BiometricErrorCode =
  | 'ENROLLMENT_NOT_FOUND'
  | 'ENROLLMENT_REVOKED'
  | 'ENROLLMENT_EXPIRED'
  | 'CONSENT_REQUIRED'
  | 'INVALID_TEMPLATE'
  | 'ALGORITHM_MISMATCH'
  | 'TICKET_ALREADY_REDEEMED';

export class BiometricError extends Error {
  constructor(
    public readonly code: BiometricErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BiometricError';
  }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  encryption: BiometricEncryptionAdapter;
  faceMatch: FaceMatchAdapter;
  now?: () => Date;
}

export interface GdprExport {
  userId: string;
  enrollments: Array<{
    id: string;
    eventId: string;
    ticketId: string;
    status: EnrollmentStatus;
    templateAlgorithm: string;
    consentVersion: string;
    consentedAt: Date;
    consentSource: ConsentSource;
    enrolledAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    deletedAt: Date | null;
  }>;
  matchAttempts: Array<{
    id: string;
    enrollmentId: string | null;
    eventId: string;
    gateId: string;
    result: MatchResult;
    confidence: number;
    matchedAt: Date;
    ticketRedeemed: boolean;
  }>;
}
