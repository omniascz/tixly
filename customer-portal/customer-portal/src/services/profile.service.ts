import { PortalError } from '../lib/portal-errors';

// ---------------------------------------------------------------------------
// DB interface
// ---------------------------------------------------------------------------

export interface PortalDB {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  execute: (sql: string, params?: unknown[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomerProfile {
  id: string;
  userId: string;
  promoterId: string;
  displayName: string | null;
  phone: string | null;
  birthDate: string | null;
  preferredLanguage: string;
  notificationEmail: boolean;
  notificationSms: boolean;
  notificationPush: boolean;
  marketingConsent: boolean;
  termsAcceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileInput {
  displayName?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  preferredLanguage?: string;
  notificationEmail?: boolean;
  notificationSms?: boolean;
  notificationPush?: boolean;
  marketingConsent?: boolean;
}

export interface UpdateProfileInput {
  displayName?: string | null;
  phone?: string | null;
  birthDate?: string | null;
  preferredLanguage?: string;
  marketingConsent?: boolean;
}

export interface NotificationPrefsInput {
  notificationEmail?: boolean;
  notificationSms?: boolean;
  notificationPush?: boolean;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  user_id: string;
  promoter_id: string;
  display_name: string | null;
  phone: string | null;
  birth_date: string | null;
  preferred_language: string;
  notification_email: boolean;
  notification_sms: boolean;
  notification_push: boolean;
  marketing_consent: boolean;
  terms_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapProfile(row: ProfileRow): CustomerProfile {
  return {
    id: row.id,
    userId: row.user_id,
    promoterId: row.promoter_id,
    displayName: row.display_name,
    phone: row.phone,
    birthDate: row.birth_date,
    preferredLanguage: row.preferred_language,
    notificationEmail: row.notification_email,
    notificationSms: row.notification_sms,
    notificationPush: row.notification_push,
    marketingConsent: row.marketing_consent,
    termsAcceptedAt: row.terms_accepted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createProfile(
  userId: string,
  promoterId: string,
  input: CreateProfileInput,
  db: PortalDB,
): Promise<CustomerProfile> {
  // Check for duplicate first
  const { rows: existing } = await db.query<ProfileRow>(
    `SELECT * FROM reservations.customer_profiles WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  if (existing[0]) {
    throw new PortalError('PROFILE_DUPLICATE');
  }

  await db.execute(
    `INSERT INTO reservations.customer_profiles
       (user_id, promoter_id, display_name, phone, birth_date, preferred_language,
        notification_email, notification_sms, notification_push, marketing_consent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      userId,
      promoterId,
      input.displayName ?? null,
      input.phone ?? null,
      input.birthDate ?? null,
      input.preferredLanguage ?? 'cs',
      input.notificationEmail ?? true,
      input.notificationSms ?? false,
      input.notificationPush ?? true,
      input.marketingConsent ?? false,
    ],
  );

  const { rows } = await db.query<ProfileRow>(
    `SELECT * FROM reservations.customer_profiles WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  if (!rows[0]) {
    throw new PortalError('PROFILE_NOT_FOUND');
  }

  return mapProfile(rows[0]);
}

export async function getProfile(
  userId: string,
  promoterId: string,
  db: PortalDB,
): Promise<CustomerProfile> {
  const { rows } = await db.query<ProfileRow>(
    `SELECT * FROM reservations.customer_profiles WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  if (!rows[0]) {
    throw new PortalError('PROFILE_NOT_FOUND');
  }

  return mapProfile(rows[0]);
}

export async function updateProfile(
  userId: string,
  promoterId: string,
  input: UpdateProfileInput,
  db: PortalDB,
): Promise<CustomerProfile> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  if (input.displayName !== undefined) { sets.push(`display_name = $${idx++}`); params.push(input.displayName); }
  if (input.phone !== undefined) { sets.push(`phone = $${idx++}`); params.push(input.phone); }
  if (input.birthDate !== undefined) { sets.push(`birth_date = $${idx++}`); params.push(input.birthDate); }
  if (input.preferredLanguage !== undefined) { sets.push(`preferred_language = $${idx++}`); params.push(input.preferredLanguage); }
  if (input.marketingConsent !== undefined) { sets.push(`marketing_consent = $${idx++}`); params.push(input.marketingConsent); }

  params.push(userId, promoterId);

  await db.execute(
    `UPDATE reservations.customer_profiles SET ${sets.join(', ')} WHERE user_id = $${idx} AND promoter_id = $${idx + 1}`,
    params,
  );

  const { rows } = await db.query<ProfileRow>(
    `SELECT * FROM reservations.customer_profiles WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  if (!rows[0]) {
    throw new PortalError('PROFILE_NOT_FOUND');
  }

  return mapProfile(rows[0]);
}

export async function updateNotificationPrefs(
  userId: string,
  promoterId: string,
  prefs: NotificationPrefsInput,
  db: PortalDB,
): Promise<CustomerProfile> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let idx = 1;

  if (prefs.notificationEmail !== undefined) { sets.push(`notification_email = $${idx++}`); params.push(prefs.notificationEmail); }
  if (prefs.notificationSms !== undefined) { sets.push(`notification_sms = $${idx++}`); params.push(prefs.notificationSms); }
  if (prefs.notificationPush !== undefined) { sets.push(`notification_push = $${idx++}`); params.push(prefs.notificationPush); }

  params.push(userId, promoterId);

  await db.execute(
    `UPDATE reservations.customer_profiles SET ${sets.join(', ')} WHERE user_id = $${idx} AND promoter_id = $${idx + 1}`,
    params,
  );

  const { rows } = await db.query<ProfileRow>(
    `SELECT * FROM reservations.customer_profiles WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  if (!rows[0]) {
    throw new PortalError('PROFILE_NOT_FOUND');
  }

  return mapProfile(rows[0]);
}

export async function acceptTerms(
  userId: string,
  promoterId: string,
  db: PortalDB,
): Promise<CustomerProfile> {
  await db.execute(
    `UPDATE reservations.customer_profiles
     SET terms_accepted_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  const { rows } = await db.query<ProfileRow>(
    `SELECT * FROM reservations.customer_profiles WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  if (!rows[0]) {
    throw new PortalError('PROFILE_NOT_FOUND');
  }

  return mapProfile(rows[0]);
}

export async function deleteProfile(
  userId: string,
  promoterId: string,
  db: PortalDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.customer_profiles WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );
}
