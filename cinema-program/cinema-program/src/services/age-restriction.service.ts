import { CinemaProgramError } from '../lib/cinema-program-errors';

// ---------------------------------------------------------------------------
// DB adapter (shared interface)
// ---------------------------------------------------------------------------

export interface CinemaProgramDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationMethod = 'self_declared' | 'bankid' | 'ocr';

export interface AgeRestrictionRuleInput {
  minAge: number;
  requiresIdCheck?: boolean;
  description?: string;
}

export interface AgeRestrictionRule {
  id: string;
  promoterId: string;
  rating: string;
  minAge: number;
  requiresIdCheck: boolean;
  description: string | null;
  createdAt: string;
}

export interface AgeVerification {
  id: string;
  screeningId: string;
  userId: string;
  verifiedAt: string;
  method: VerificationMethod;
  birthDate: string;
  ageAtVerification: number;
}

export interface AgeCheckResult {
  allowed: boolean;
  age: number;
  minAge: number;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface RuleRow {
  id: string;
  promoter_id: string;
  rating: string;
  min_age: number;
  requires_id_check: boolean;
  description: string | null;
  created_at: string;
}

interface VerificationRow {
  id: string;
  screening_id: string;
  user_id: string;
  verified_at: string;
  method: VerificationMethod;
  birth_date: string;
  age_at_verification: number;
}

interface ScreeningFilmRow {
  film_rating: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRule(row: RuleRow): AgeRestrictionRule {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    rating: row.rating,
    minAge: row.min_age,
    requiresIdCheck: row.requires_id_check,
    description: row.description,
    createdAt: row.created_at,
  };
}

function mapVerification(row: VerificationRow): AgeVerification {
  return {
    id: row.id,
    screeningId: row.screening_id,
    userId: row.user_id,
    verifiedAt: row.verified_at,
    method: row.method,
    birthDate: row.birth_date,
    ageAtVerification: row.age_at_verification,
  };
}

function calculateAge(birthDate: Date, referenceDate: Date): number {
  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const m = referenceDate.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && referenceDate.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createRule(
  promoterId: string,
  rating: string,
  input: AgeRestrictionRuleInput,
  db: CinemaProgramDB,
): Promise<AgeRestrictionRule> {
  const { rows } = await db.query<RuleRow>(
    `INSERT INTO cinema.age_restriction_rules
       (promoter_id, rating, min_age, requires_id_check, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      promoterId,
      rating,
      input.minAge,
      input.requiresIdCheck ?? false,
      input.description ?? null,
    ],
  );

  if (!rows[0]) {
    throw new CinemaProgramError('RULE_DUPLICATE');
  }

  return mapRule(rows[0]);
}

export async function getRule(
  promoterId: string,
  rating: string,
  db: CinemaProgramDB,
): Promise<AgeRestrictionRule | null> {
  const { rows } = await db.query<RuleRow>(
    `SELECT * FROM cinema.age_restriction_rules
     WHERE promoter_id = $1 AND rating = $2`,
    [promoterId, rating],
  );

  return rows[0] ? mapRule(rows[0]) : null;
}

export async function listRules(
  promoterId: string,
  db: CinemaProgramDB,
): Promise<AgeRestrictionRule[]> {
  const { rows } = await db.query<RuleRow>(
    `SELECT * FROM cinema.age_restriction_rules
     WHERE promoter_id = $1
     ORDER BY min_age ASC`,
    [promoterId],
  );

  return rows.map(mapRule);
}

export async function updateRule(
  promoterId: string,
  rating: string,
  input: Partial<AgeRestrictionRuleInput>,
  db: CinemaProgramDB,
): Promise<AgeRestrictionRule> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.minAge !== undefined) {
    sets.push(`min_age = $${idx}`);
    params.push(input.minAge);
    idx++;
  }
  if (input.requiresIdCheck !== undefined) {
    sets.push(`requires_id_check = $${idx}`);
    params.push(input.requiresIdCheck);
    idx++;
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx}`);
    params.push(input.description);
    idx++;
  }

  params.push(promoterId, rating);

  const { rows } = await db.query<RuleRow>(
    `UPDATE cinema.age_restriction_rules
     SET ${sets.join(', ')}
     WHERE promoter_id = $${idx} AND rating = $${idx + 1}
     RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new CinemaProgramError('RULE_NOT_FOUND');
  }

  return mapRule(rows[0]);
}

/**
 * Check age for a screening.
 * Flow: query(screening+film rating) → query(rule) → execute(insert verification)
 * If no rule exists for the rating → allow by default.
 * If age < minAge → throw AGE_TOO_YOUNG.
 * Otherwise INSERT verification and return { allowed: true, age, minAge }.
 */
export async function checkAgeForScreening(
  screeningId: string,
  userId: string,
  birthDate: string,
  method: VerificationMethod,
  db: CinemaProgramDB,
): Promise<AgeCheckResult> {
  // Query 1: get film rating via screening
  const { rows: screeningRows } = await db.query<ScreeningFilmRow>(
    `SELECT f.rating AS film_rating
     FROM cinema.screenings s
     JOIN cinema.films f ON f.id = s.film_id
     WHERE s.id = $1`,
    [screeningId],
  );

  const filmRating = screeningRows[0]?.film_rating ?? null;

  const birth = new Date(birthDate);
  const now = new Date();
  const age = calculateAge(birth, now);

  // Query 2: get rule for this rating
  let minAge = 0;
  if (filmRating) {
    const { rows: ruleRows } = await db.query<{ min_age: number; promoter_id: string }>(
      `SELECT arr.min_age, arr.promoter_id
       FROM cinema.age_restriction_rules arr
       JOIN cinema.screenings s ON s.id = $1
       JOIN cinema.auditoriums a ON a.id = s.auditorium_id
       JOIN cinema.venues v ON v.id = a.venue_id
       WHERE arr.rating = $2 AND arr.promoter_id = v.promoter_id`,
      [screeningId, filmRating],
    );

    if (ruleRows[0]) {
      minAge = ruleRows[0].min_age;
    }
    // If no rule found, minAge stays 0 → allow by default
  }

  if (age < minAge) {
    throw new CinemaProgramError('AGE_TOO_YOUNG');
  }

  // Execute (does NOT increment index): insert verification
  await db.execute(
    `INSERT INTO cinema.age_verifications
       (screening_id, user_id, method, birth_date, age_at_verification)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (screening_id, user_id) DO NOTHING`,
    [screeningId, userId, method, birthDate, age],
  );

  return { allowed: true, age, minAge };
}

export async function getVerification(
  screeningId: string,
  userId: string,
  db: CinemaProgramDB,
): Promise<AgeVerification | null> {
  const { rows } = await db.query<VerificationRow>(
    `SELECT * FROM cinema.age_verifications
     WHERE screening_id = $1 AND user_id = $2`,
    [screeningId, userId],
  );

  return rows[0] ? mapVerification(rows[0]) : null;
}

export async function hasVerification(
  screeningId: string,
  userId: string,
  db: CinemaProgramDB,
): Promise<boolean> {
  const { rows } = await db.query<{ exists_flag: string }>(
    `SELECT 1 AS exists_flag FROM cinema.age_verifications
     WHERE screening_id = $1 AND user_id = $2
     LIMIT 1`,
    [screeningId, userId],
  );

  return rows.length > 0;
}

export async function listVerificationsForScreening(
  screeningId: string,
  db: CinemaProgramDB,
): Promise<AgeVerification[]> {
  const { rows } = await db.query<VerificationRow>(
    `SELECT * FROM cinema.age_verifications
     WHERE screening_id = $1
     ORDER BY verified_at DESC`,
    [screeningId],
  );

  return rows.map(mapVerification);
}
