import crypto from 'crypto';
import { ServiceDeps } from '../lib/service-container';
import { OnboardingError, RateLimitError } from '../lib/onboarding-errors';
import { validateIco, validateCzIban } from '../lib/validators';
import {
  verificationEmail,
  welcomeEmail,
  kycSubmittedPromoterEmail,
  kycApprovedEmail,
  kycRejectedEmail,
  adminKycNotificationEmail,
} from '../lib/email-templates';
import type {
  RegisterUserInput,
  CreatePromoterProfileInput,
  SubmitKycInput,
  AdminKycReviewInput,
  OnboardingStatus,
  OnboardingStep,
  KycDocument,
  PendingKycItem,
  PromoterAdmin,
  KycReview,
} from '../types/onboarding';

// ---------------------------------------------------------------------------
// Bcrypt dependency — injected so tests can mock it
// ---------------------------------------------------------------------------
export interface BcryptLike {
  hash(data: string, saltOrRounds: string | number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
}

let _bcrypt: BcryptLike | null = null;

export function setBcrypt(b: BcryptLike): void {
  _bcrypt = b;
}

async function hashPassword(password: string): Promise<string> {
  if (_bcrypt) {
    return _bcrypt.hash(password, 12);
  }
  // Lazy-load bcrypt in production
  const bcrypt = await import('bcrypt');
  return bcrypt.hash(password, 12);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

const VERIFICATION_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours
const RESEND_RATE_LIMIT = 3;
const RESEND_RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@tixly.cz';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.tixly.cz';
const ADMIN_URL = process.env.ADMIN_URL ?? 'https://admin.tixly.cz';

// ---------------------------------------------------------------------------
// Row types returned from DB
// ---------------------------------------------------------------------------
interface UserRow {
  id: string;
  email: string;
  email_verified: boolean;
}

interface EmailVerificationRow {
  id: string;
  user_id: string;
  email: string;
  is_used: boolean;
  expires_at: string;
}

interface PromoterRow {
  id: string;
  name: string;
  legal_name: string | null;
  ico: string;
  dic: string | null;
  phone: string;
  website: string | null;
  status: 'pending' | 'active' | 'suspended' | 'banned';
  kyc_status: 'not_started' | 'submitted' | 'verified' | 'rejected';
  kyc_notes: string | null;
  bank_account_iban: string | null;
  bank_account_swift: string | null;
  created_at: string;
}

interface PromoterMemberRow {
  promoter_id: string;
  role: string;
}

interface OnboardingProgressRow {
  promoter_id: string;
  step_account: boolean;
  step_profile: boolean;
  step_kyc: boolean;
  step_activated: boolean;
  completed_at: string | null;
  updated_at: string;
}

interface KycDocumentRow {
  id: string;
  promoter_id: string;
  document_type: KycDocument['documentType'];
  file_name: string;
  file_size: number;
  storage_key: string;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
}

interface KycReviewRow {
  id: string;
  promoter_id: string;
  admin_user_id: string;
  decision: 'approved' | 'rejected' | 'request_more_info';
  notes: string | null;
  created_at: string;
}

interface PendingKycRow {
  id: string;
  name: string;
  ico: string;
  kyc_submitted_at: string;
  document_count: string; // COUNT returns string in pg
}

interface CountRow {
  count: string;
}

// ---------------------------------------------------------------------------
// Compute current onboarding step
// ---------------------------------------------------------------------------
function computeCurrentStep(
  progress: OnboardingProgressRow,
  kycStatus: PromoterRow['kyc_status'],
  promoterStatus: PromoterRow['status'],
): OnboardingStep {
  if (promoterStatus === 'active' && progress.step_activated) return 'active';
  if (progress.step_kyc) return 'review';
  if (progress.step_profile) return 'kyc';
  if (progress.step_account) return 'profile';
  return 'account';
}

// ---------------------------------------------------------------------------
// Step 1: Register user
// ---------------------------------------------------------------------------
export async function registerUser(
  input: RegisterUserInput,
  deps: ServiceDeps,
): Promise<{ userId: string }> {
  const { db, kafka, email } = deps;

  // Check if email already exists
  const existing = await db.query<UserRow>(
    'SELECT id FROM identity.users WHERE email = $1',
    [input.email.toLowerCase()],
  );
  if (existing.length > 0) {
    throw new OnboardingError('EMAIL_ALREADY_REGISTERED');
  }

  const passwordHash = await hashPassword(input.password);

  // Insert new user
  const userRows = await db.query<{ id: string }>(
    `INSERT INTO identity.users (first_name, last_name, email, password_hash, email_verified)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING id`,
    [input.firstName, input.lastName, input.email.toLowerCase(), passwordHash],
  );
  const userId = userRows[0].id;

  // Generate verification token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_SECONDS * 1000).toISOString();

  await db.execute(
    `INSERT INTO identity.email_verifications (user_id, email, token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, input.email.toLowerCase(), token, expiresAt],
  );

  const verificationUrl = `${APP_URL}/verify-email?token=${token}`;
  const { subject, html } = verificationEmail(input.email, verificationUrl);
  await email.send(input.email, subject, html);

  kafka.send('user.registered', { userId, email: input.email.toLowerCase() }).catch(() => {});

  return { userId };
}

// ---------------------------------------------------------------------------
// Rate limit helper for email verification attempts
// ---------------------------------------------------------------------------
const VERIFY_RATE_LIMIT = 10;
const VERIFY_RATE_LIMIT_WINDOW_SECONDS = 60;

async function checkVerifyRateLimit(redis: ServiceDeps['redis'], userId: string): Promise<void> {
  const key = `tixly:ratelimit:onboarding:verify:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, VERIFY_RATE_LIMIT_WINDOW_SECONDS);
  }
  if (count > VERIFY_RATE_LIMIT) {
    throw new RateLimitError('Too many verification attempts. Try again in 60 seconds.');
  }
}

// ---------------------------------------------------------------------------
// Step 2a: Verify email
// ---------------------------------------------------------------------------
export async function verifyEmail(
  token: string,
  deps: ServiceDeps,
): Promise<{ userId: string; email: string }> {
  const { db, redis, kafka } = deps;

  const rows = await db.query<EmailVerificationRow>(
    `SELECT id, user_id, email, is_used, expires_at
     FROM identity.email_verifications
     WHERE token = $1`,
    [token],
  );

  if (rows.length === 0) {
    throw new OnboardingError('VERIFICATION_TOKEN_INVALID');
  }

  const record = rows[0];

  // Rate limit: max 10 attempts per userId per 60 seconds
  await checkVerifyRateLimit(redis, record.user_id);

  if (record.is_used) {
    throw new OnboardingError('VERIFICATION_TOKEN_USED');
  }

  if (new Date(record.expires_at) < new Date()) {
    throw new OnboardingError('VERIFICATION_TOKEN_EXPIRED');
  }

  await db.execute(
    `UPDATE identity.email_verifications SET is_used = TRUE WHERE id = $1`,
    [record.id],
  );

  await db.execute(
    `UPDATE identity.users
     SET email_verified = TRUE, email_verified_at = NOW()
     WHERE id = $1`,
    [record.user_id],
  );

  kafka
    .send('user.email_verified', { userId: record.user_id, email: record.email })
    .catch(() => {});

  return { userId: record.user_id, email: record.email };
}

// ---------------------------------------------------------------------------
// Step 2b: Resend verification email
// ---------------------------------------------------------------------------
export async function resendVerificationEmail(
  userId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, redis, email } = deps;

  // Check if email already verified
  const userRows = await db.query<UserRow>(
    'SELECT id, email, email_verified FROM identity.users WHERE id = $1',
    [userId],
  );

  if (userRows.length === 0 || userRows[0].email_verified) {
    // Silently return — anti-enumeration / already done
    return;
  }

  const user = userRows[0];

  // Rate limit check
  const rateLimitKey = `tixly:ratelimit:onboarding:resend:${userId}`;
  const currentCount = await redis.get(rateLimitKey);
  if (currentCount !== null && parseInt(currentCount, 10) >= RESEND_RATE_LIMIT) {
    // Silently return rather than exposing rate limit detail to caller
    return;
  }

  // Increment rate limit counter
  const newCount = currentCount === null ? 1 : parseInt(currentCount, 10) + 1;
  await redis.setex(rateLimitKey, RESEND_RATE_LIMIT_WINDOW_SECONDS, String(newCount));

  // Revoke all existing unused tokens
  await db.execute(
    `UPDATE identity.email_verifications
     SET is_used = TRUE
     WHERE user_id = $1 AND is_used = FALSE AND expires_at > NOW()`,
    [userId],
  );

  // Generate new token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_SECONDS * 1000).toISOString();

  await db.execute(
    `INSERT INTO identity.email_verifications (user_id, email, token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, user.email, token, expiresAt],
  );

  const verificationUrl = `${APP_URL}/verify-email?token=${token}`;
  const { subject, html } = verificationEmail(user.email, verificationUrl);
  await email.send(user.email, subject, html);
}

// ---------------------------------------------------------------------------
// Step 3: Create promoter profile
// ---------------------------------------------------------------------------
export async function createPromoterProfile(
  userId: string,
  input: CreatePromoterProfileInput,
  deps: ServiceDeps,
): Promise<{ promoterId: string }> {
  const { db, kafka } = deps;

  // Check email verified
  const userRows = await db.query<UserRow>(
    'SELECT id, email, email_verified FROM identity.users WHERE id = $1',
    [userId],
  );

  if (userRows.length === 0 || !userRows[0].email_verified) {
    throw new OnboardingError('EMAIL_NOT_VERIFIED');
  }

  // Check if user already has a promoter
  const memberRows = await db.query<PromoterMemberRow>(
    `SELECT promoter_id FROM platform.promoter_members WHERE user_id = $1 AND role = 'owner'`,
    [userId],
  );
  if (memberRows.length > 0) {
    throw new OnboardingError('PROMOTER_ALREADY_EXISTS');
  }

  // Validate IČO
  if (!validateIco(input.ico)) {
    throw new OnboardingError('INVALID_ICO');
  }

  const promoterRows = await db.query<{ id: string }>(
    `INSERT INTO platform.promoters
       (name, legal_name, ico, dic, phone, website, default_currency, timezone, status, kyc_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'not_started')
     RETURNING id`,
    [
      input.name,
      input.legalName ?? null,
      input.ico,
      input.dic ?? null,
      input.phone,
      input.website ?? null,
      input.defaultCurrency ?? 'CZK',
      input.timezone ?? 'Europe/Prague',
    ],
  );
  const promoterId = promoterRows[0].id;

  await db.execute(
    `INSERT INTO platform.promoter_members (promoter_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')`,
    [promoterId, userId],
  );

  await db.execute(
    `INSERT INTO platform.onboarding_progress (promoter_id, step_account, step_profile)
     VALUES ($1, TRUE, TRUE)`,
    [promoterId],
  );

  kafka
    .send('promoter.profile_created', { promoterId, userId, name: input.name })
    .catch(() => {});

  return { promoterId };
}

// ---------------------------------------------------------------------------
// Step 4: Submit KYC
// ---------------------------------------------------------------------------
export async function submitKyc(
  promoterId: string,
  userId: string,
  input: SubmitKycInput,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka, email } = deps;

  // Verify ownership
  const memberRows = await db.query<PromoterMemberRow>(
    `SELECT promoter_id FROM platform.promoter_members
     WHERE promoter_id = $1 AND user_id = $2 AND role = 'owner'`,
    [promoterId, userId],
  );
  if (memberRows.length === 0) {
    throw new OnboardingError('UNAUTHORIZED');
  }

  // Validate IBAN
  if (!validateCzIban(input.bankAccountIban)) {
    throw new OnboardingError('INVALID_IBAN');
  }

  // Check KYC status
  const promoterRows = await db.query<PromoterRow>(
    'SELECT id, name, kyc_status FROM platform.promoters WHERE id = $1',
    [promoterId],
  );
  if (promoterRows.length === 0) {
    throw new OnboardingError('ONBOARDING_NOT_FOUND');
  }
  const promoter = promoterRows[0];

  if (promoter.kyc_status === 'submitted' || promoter.kyc_status === 'verified') {
    throw new OnboardingError('KYC_ALREADY_SUBMITTED');
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE platform.promoters
       SET bank_account_iban = $1, bank_account_swift = $2, kyc_status = 'submitted'
       WHERE id = $3`,
      [input.bankAccountIban, input.bankAccountSwift, promoterId],
    );

    for (const doc of input.documents) {
      await tx.execute(
        `INSERT INTO platform.kyc_documents
           (promoter_id, document_type, file_name, file_size, storage_key, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          promoterId,
          doc.documentType,
          doc.fileName,
          doc.fileSize,
          doc.storageKey,
          doc.mimeType,
          userId,
        ],
      );
    }

    await tx.execute(
      `UPDATE platform.onboarding_progress
       SET step_kyc = TRUE, updated_at = NOW()
       WHERE promoter_id = $1`,
      [promoterId],
    );
  });

  // Notify admin
  const adminUrl = `${ADMIN_URL}/kyc/${promoterId}`;
  const { subject, html } = adminKycNotificationEmail(promoter.name, promoterId, adminUrl);
  await email.send(ADMIN_EMAIL, subject, html);

  // Notify promoter
  const { subject: pSubject, html: pHtml } = kycSubmittedPromoterEmail(promoter.name);
  // Get promoter email via owner user
  const ownerRows = await db.query<{ email: string }>(
    `SELECT u.email FROM identity.users u
     JOIN platform.promoter_members pm ON pm.user_id = u.id
     WHERE pm.promoter_id = $1 AND pm.role = 'owner'`,
    [promoterId],
  );
  if (ownerRows.length > 0) {
    await email.send(ownerRows[0].email, pSubject, pHtml);
  }

  kafka.send('promoter.kyc.submitted', { promoterId }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Step 5: Admin KYC review
// ---------------------------------------------------------------------------
export async function reviewKyc(
  promoterId: string,
  adminUserId: string,
  input: AdminKycReviewInput,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka, email } = deps;

  const promoterRows = await db.query<PromoterRow>(
    'SELECT id, name, kyc_status FROM platform.promoters WHERE id = $1',
    [promoterId],
  );
  if (promoterRows.length === 0) {
    throw new OnboardingError('ONBOARDING_NOT_FOUND');
  }
  const promoter = promoterRows[0];

  if (promoter.kyc_status !== 'submitted') {
    throw new OnboardingError('KYC_NOT_SUBMITTED');
  }

  if (
    (input.decision === 'rejected' || input.decision === 'request_more_info') &&
    (!input.notes || input.notes.trim() === '')
  ) {
    throw new OnboardingError('NOTES_REQUIRED');
  }

  // Insert review log
  await db.execute(
    `INSERT INTO platform.kyc_reviews (promoter_id, admin_user_id, decision, notes)
     VALUES ($1, $2, $3, $4)`,
    [promoterId, adminUserId, input.decision, input.notes ?? null],
  );

  // Get promoter owner email
  const ownerRows = await db.query<{ email: string }>(
    `SELECT u.email FROM identity.users u
     JOIN platform.promoter_members pm ON pm.user_id = u.id
     WHERE pm.promoter_id = $1 AND pm.role = 'owner'`,
    [promoterId],
  );
  const promoterEmail = ownerRows.length > 0 ? ownerRows[0].email : null;

  if (input.decision === 'approved') {
    await db.execute(
      `UPDATE platform.promoters
       SET kyc_status = 'verified', kyc_verified_at = NOW(), status = 'active'
       WHERE id = $1`,
      [promoterId],
    );
    await db.execute(
      `UPDATE platform.onboarding_progress
       SET step_activated = TRUE, completed_at = NOW(), updated_at = NOW()
       WHERE promoter_id = $1`,
      [promoterId],
    );
    if (promoterEmail) {
      const dashboardUrl = `${APP_URL}/dashboard`;
      const { subject, html } = kycApprovedEmail(promoter.name, dashboardUrl);
      await email.send(promoterEmail, subject, html);
    }
    kafka.send('promoter.activated', { promoterId }).catch(() => {});
  } else if (input.decision === 'rejected') {
    await db.execute(
      `UPDATE platform.promoters
       SET kyc_status = 'rejected', kyc_notes = $1
       WHERE id = $2`,
      [input.notes!, promoterId],
    );
    if (promoterEmail) {
      const { subject, html } = kycRejectedEmail(promoter.name, input.notes!);
      await email.send(promoterEmail, subject, html);
    }
    kafka.send('promoter.kyc.rejected', { promoterId, notes: input.notes }).catch(() => {});
  } else {
    // request_more_info — kyc_status stays 'submitted', notes stored
    await db.execute(
      `UPDATE platform.promoters
       SET kyc_notes = $1
       WHERE id = $2`,
      [input.notes!, promoterId],
    );
    if (promoterEmail) {
      const { subject, html } = kycRejectedEmail(promoter.name, input.notes!);
      await email.send(promoterEmail, subject, html);
    }
    kafka.send('promoter.kyc.info_requested', { promoterId, notes: input.notes }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Get onboarding status
// ---------------------------------------------------------------------------
export async function getOnboardingStatus(
  promoterId: string,
  deps: ServiceDeps,
): Promise<OnboardingStatus> {
  const { db } = deps;

  const rows = await db.query<
    PromoterRow &
      OnboardingProgressRow & {
        // merged columns
        kyc_rejection_notes: string | null;
      }
  >(
    `SELECT
       p.id AS id,
       p.status,
       p.kyc_status,
       p.kyc_notes AS kyc_rejection_notes,
       op.step_account,
       op.step_profile,
       op.step_kyc,
       op.step_activated,
       op.completed_at
     FROM platform.promoters p
     LEFT JOIN platform.onboarding_progress op ON op.promoter_id = p.id
     WHERE p.id = $1`,
    [promoterId],
  );

  if (rows.length === 0) {
    throw new OnboardingError('ONBOARDING_NOT_FOUND');
  }

  const row = rows[0];

  const progress: OnboardingProgressRow = {
    promoter_id: promoterId,
    step_account: row.step_account ?? false,
    step_profile: row.step_profile ?? false,
    step_kyc: row.step_kyc ?? false,
    step_activated: row.step_activated ?? false,
    completed_at: row.completed_at ?? null,
    updated_at: '',
  };

  const currentStep = computeCurrentStep(progress, row.kyc_status, row.status);

  return {
    promoterId,
    currentStep,
    steps: {
      account: progress.step_account,
      profile: progress.step_profile,
      kyc: progress.step_kyc,
      activated: progress.step_activated,
    },
    promoterStatus: row.status,
    kycStatus: row.kyc_status,
    kycRejectionNotes: row.kyc_rejection_notes,
    completedAt: progress.completed_at,
  };
}

// ---------------------------------------------------------------------------
// Get KYC documents
// ---------------------------------------------------------------------------
export async function getKycDocuments(
  promoterId: string,
  deps: ServiceDeps,
): Promise<KycDocument[]> {
  const { db } = deps;

  const rows = await db.query<KycDocumentRow>(
    `SELECT id, promoter_id, document_type, file_name, file_size, storage_key, mime_type, uploaded_by, created_at
     FROM platform.kyc_documents
     WHERE promoter_id = $1
     ORDER BY created_at ASC`,
    [promoterId],
  );

  return rows.map((r) => ({
    id: r.id,
    promoterId: r.promoter_id,
    documentType: r.document_type,
    fileName: r.file_name,
    fileSize: r.file_size,
    storageKey: r.storage_key,
    mimeType: r.mime_type,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Admin: list pending KYC
// ---------------------------------------------------------------------------
export async function adminListPendingKyc(
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: PendingKycItem[]; total: number }> {
  const { db } = deps;
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  const rows = await db.query<PendingKycRow>(
    `SELECT
       p.id,
       p.name,
       p.ico,
       p.updated_at AS kyc_submitted_at,
       COUNT(kd.id) AS document_count
     FROM platform.promoters p
     LEFT JOIN platform.kyc_documents kd ON kd.promoter_id = p.id
     WHERE p.kyc_status = 'submitted'
     GROUP BY p.id, p.name, p.ico, p.updated_at
     ORDER BY p.updated_at ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const countRows = await db.query<CountRow>(
    `SELECT COUNT(*) AS count FROM platform.promoters WHERE kyc_status = 'submitted'`,
  );

  return {
    items: rows.map((r) => ({
      promoterId: r.id,
      name: r.name,
      ico: r.ico,
      submittedAt: r.kyc_submitted_at,
      documentCount: parseInt(r.document_count, 10),
    })),
    total: parseInt(countRows[0]?.count ?? '0', 10),
  };
}

// ---------------------------------------------------------------------------
// Admin: get full KYC detail
// ---------------------------------------------------------------------------
export async function adminGetKycDetail(
  promoterId: string,
  deps: ServiceDeps,
): Promise<{ promoter: PromoterAdmin; documents: KycDocument[]; reviews: KycReview[] }> {
  const { db } = deps;

  const promoterRows = await db.query<PromoterRow>(
    `SELECT id, name, legal_name, ico, dic, phone, website, status, kyc_status,
            kyc_notes, bank_account_iban, bank_account_swift, created_at
     FROM platform.promoters WHERE id = $1`,
    [promoterId],
  );
  if (promoterRows.length === 0) {
    throw new OnboardingError('ONBOARDING_NOT_FOUND');
  }
  const p = promoterRows[0];

  const documents = await getKycDocuments(promoterId, deps);

  const reviewRows = await db.query<KycReviewRow>(
    `SELECT id, promoter_id, admin_user_id, decision, notes, created_at
     FROM platform.kyc_reviews
     WHERE promoter_id = $1
     ORDER BY created_at DESC`,
    [promoterId],
  );

  const reviews: KycReview[] = reviewRows.map((r) => ({
    id: r.id,
    promoterId: r.promoter_id,
    adminUserId: r.admin_user_id,
    decision: r.decision,
    notes: r.notes,
    createdAt: r.created_at,
  }));

  return {
    promoter: {
      id: p.id,
      name: p.name,
      legalName: p.legal_name,
      ico: p.ico,
      dic: p.dic,
      phone: p.phone,
      website: p.website,
      status: p.status,
      kycStatus: p.kyc_status,
      kycNotes: p.kyc_notes,
      bankAccountIban: p.bank_account_iban,
      bankAccountSwift: p.bank_account_swift,
      createdAt: p.created_at,
    },
    documents,
    reviews,
  };
}
