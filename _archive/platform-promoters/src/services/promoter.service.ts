import { PlatformError } from '../lib/platform-errors.js';
import { generateUniqueSlug } from '../lib/slug.js';
import type { ServiceDeps } from '../lib/service-container.js';
import type {
  CreatePromoterInput,
  UpdatePromoterInput,
  BankAccountInput,
  CreateFeeScheduleInput,
  PromoterFilters,
} from '../lib/zod-schemas.js';
import type {
  PromoterAdmin,
  PromoterMember,
  FeeSchedule,
  MemberRole,
  PromoterStatus,
  KycStatus,
} from '../types/platform.js';

// ─── Row types (DB → TS) ──────────────────────────────────────────────────────

interface PromoterRow {
  id: string;
  name: string;
  legal_name: string | null;
  ico: string | null;
  dic: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  logo_url: string | null;
  brand_colors: Record<string, string>;
  slug: string | null;
  status: PromoterStatus;
  kyc_status: KycStatus;
  kyc_verified_at: Date | string | null;
  kyc_notes: string | null;
  bank_account_iban: string | null;
  bank_account_swift: string | null;
  stripe_account_id: string | null;
  default_currency: string;
  timezone: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MemberRow {
  id: string;
  promoter_id: string;
  user_id: string;
  role: MemberRole;
  status: 'invited' | 'active' | 'deactivated';
  invited_at: Date | string;
  activated_at: Date | string | null;
}

interface FeeScheduleRow {
  id: string;
  promoter_id: string;
  name: string;
  percentage_fee: number;
  fixed_fee: number;
  min_fee: number | null;
  max_fee: number | null;
  valid_from: Date | string;
  valid_until: Date | string | null;
  is_active: boolean;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapPromoterRow(row: PromoterRow): PromoterAdmin {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    ico: row.ico,
    dic: row.dic,
    email: row.email,
    phone: row.phone,
    website: row.website,
    logoUrl: row.logo_url,
    brandColors: (row.brand_colors as { primary?: string; secondary?: string; accent?: string }) ?? {},
    slug: row.slug,
    status: row.status,
    kycStatus: row.kyc_status,
    kycVerifiedAt: row.kyc_verified_at ? new Date(row.kyc_verified_at as string).toISOString() : null,
    kycNotes: row.kyc_notes,
    bankAccountIban: row.bank_account_iban,
    bankAccountSwift: row.bank_account_swift,
    stripeAccountId: row.stripe_account_id,
    defaultCurrency: row.default_currency,
    timezone: row.timezone,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function mapMemberRow(row: MemberRow): PromoterMember {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    invitedAt: new Date(row.invited_at as string).toISOString(),
    activatedAt: row.activated_at ? new Date(row.activated_at as string).toISOString() : null,
  };
}

function mapFeeRow(row: FeeScheduleRow): FeeSchedule {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    percentageFee: row.percentage_fee,
    fixedFee: row.fixed_fee,
    minFee: row.min_fee,
    maxFee: row.max_fee,
    validFrom: new Date(row.valid_from as string).toISOString(),
    validUntil: row.valid_until ? new Date(row.valid_until as string).toISOString() : null,
    isActive: row.is_active,
  };
}

// ─── PromoterService ──────────────────────────────────────────────────────────

/**
 * Vytvoří nového promotéra a registruje zakladatele jako owner.
 */
export async function createPromoter(
  input: CreatePromoterInput,
  userId: string,
  deps: ServiceDeps,
): Promise<PromoterAdmin> {
  const { db, kafka } = deps;

  const slug = await generateUniqueSlug(input.name, db);

  const rows = await db.query<PromoterRow>(
    `INSERT INTO platform.promoters
       (name, legal_name, ico, dic, email, phone, website, slug,
        status, kyc_status, default_currency, timezone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','not_started',$9,$10)
     RETURNING *`,
    [
      input.name,
      input.legalName ?? null,
      input.ico ?? null,
      input.dic ?? null,
      input.email,
      input.phone ?? null,
      input.website ?? null,
      slug,
      input.defaultCurrency ?? 'CZK',
      input.timezone ?? 'Europe/Prague',
    ],
  );

  const promoter = rows[0];

  // Vytvoř owner member
  await db.execute(
    `INSERT INTO platform.promoter_members
       (promoter_id, user_id, role, status, activated_at)
     VALUES ($1,$2,'owner','active',NOW())`,
    [promoter.id, userId],
  );

  // Fire-and-forget Kafka event
  kafka
    .send('promoter.registered', {
      promoterId: promoter.id,
      userId,
      name: promoter.name,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {/* ignore */});

  return mapPromoterRow(promoter);
}

/**
 * Aktualizuje profil promotéra. Volající musí být owner nebo admin.
 */
export async function updatePromoter(
  promoterId: string,
  input: UpdatePromoterInput,
  requesterId: string,
  deps: ServiceDeps,
): Promise<PromoterAdmin> {
  const { db } = deps;

  await assertMemberAccess(promoterId, requesterId, ['owner', 'admin'], deps);

  // Načti aktuálního promotéra
  const current = await getPromoterById(promoterId, deps);

  // Nelze měnit ico pokud kyc_status='verified'
  if (input.ico !== undefined && current.kycStatus === 'verified') {
    throw new PlatformError('INVALID_STATUS_TRANSITION', 'Cannot change ICO after KYC verification');
  }

  // Pokud se mění slug → ověř uniqueness
  if (input.slug !== undefined && input.slug !== current.slug) {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM platform.promoters WHERE slug = $1 AND id != $2`,
      [input.slug, promoterId],
    );
    if (existing.length > 0) {
      throw new PlatformError('PROMOTER_SLUG_TAKEN');
    }
  }

  const rows = await db.query<PromoterRow>(
    `UPDATE platform.promoters SET
       name             = COALESCE($1, name),
       legal_name       = CASE WHEN $2::boolean THEN $3 ELSE legal_name END,
       ico              = CASE WHEN $4::boolean THEN $5 ELSE ico END,
       dic              = CASE WHEN $6::boolean THEN $7 ELSE dic END,
       email            = COALESCE($8, email),
       phone            = CASE WHEN $9::boolean THEN $10 ELSE phone END,
       website          = CASE WHEN $11::boolean THEN $12 ELSE website END,
       logo_url         = CASE WHEN $13::boolean THEN $14 ELSE logo_url END,
       brand_colors     = CASE WHEN $15::boolean THEN $16::jsonb ELSE brand_colors END,
       slug             = CASE WHEN $17::boolean THEN $18 ELSE slug END,
       default_currency = COALESCE($19, default_currency),
       timezone         = COALESCE($20, timezone),
       updated_at       = NOW()
     WHERE id = $21
     RETURNING *`,
    [
      input.name ?? null,
      'legalName' in input, input.legalName ?? null,
      'ico' in input, input.ico ?? null,
      'dic' in input, input.dic ?? null,
      input.email ?? null,
      'phone' in input, input.phone ?? null,
      'website' in input, input.website ?? null,
      'logoUrl' in input, input.logoUrl ?? null,
      'brandColors' in input, input.brandColors ? JSON.stringify(input.brandColors) : null,
      'slug' in input, input.slug ?? null,
      input.defaultCurrency ?? null,
      input.timezone ?? null,
      promoterId,
    ],
  );

  if (rows.length === 0) {
    throw new PlatformError('PROMOTER_NOT_FOUND');
  }

  return mapPromoterRow(rows[0]);
}

/**
 * Aktualizuje bankovní účet. Vyžaduje role owner nebo finance.
 */
export async function updateBankAccount(
  promoterId: string,
  input: BankAccountInput,
  requesterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;

  await assertMemberAccess(promoterId, requesterId, ['owner', 'finance'], deps);

  await db.execute(
    `UPDATE platform.promoters
     SET bank_account_iban = $1, bank_account_swift = $2, updated_at = NOW()
     WHERE id = $3`,
    [input.iban, input.swift ?? null, promoterId],
  );
}

/**
 * Vrátí promotéra kde userId je aktivní member.
 */
export async function getMyPromoter(
  userId: string,
  deps: ServiceDeps,
): Promise<PromoterAdmin | null> {
  const { db } = deps;

  const rows = await db.query<PromoterRow>(
    `SELECT p.*
     FROM platform.promoters p
     JOIN platform.promoter_members m ON m.promoter_id = p.id
     WHERE m.user_id = $1 AND m.status = 'active'
     ORDER BY m.invited_at ASC
     LIMIT 1`,
    [userId],
  );

  return rows.length > 0 ? mapPromoterRow(rows[0]) : null;
}

/**
 * Vrátí promotéra podle ID (nebo hodí 404).
 */
export async function getPromoterById(
  promoterId: string,
  deps: ServiceDeps,
): Promise<PromoterAdmin> {
  const { db } = deps;

  const rows = await db.query<PromoterRow>(
    `SELECT * FROM platform.promoters WHERE id = $1`,
    [promoterId],
  );

  if (rows.length === 0) {
    throw new PlatformError('PROMOTER_NOT_FOUND');
  }

  return mapPromoterRow(rows[0]);
}

// ─── KYC workflow ─────────────────────────────────────────────────────────────

/**
 * Promotér submittuje KYC.
 */
export async function submitKyc(
  promoterId: string,
  requesterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  await assertMemberAccess(promoterId, requesterId, ['owner'], deps);

  const promoter = await getPromoterById(promoterId, deps);

  if (promoter.kycStatus !== 'not_started' && promoter.kycStatus !== 'rejected') {
    throw new PlatformError(
      'INVALID_STATUS_TRANSITION',
      `KYC cannot be submitted from status '${promoter.kycStatus}'`,
    );
  }

  await db.execute(
    `UPDATE platform.promoters SET kyc_status = 'submitted', updated_at = NOW() WHERE id = $1`,
    [promoterId],
  );

  kafka
    .send('promoter.kyc.submitted', { promoterId, timestamp: new Date().toISOString() })
    .catch(() => {/* ignore */});
}

/**
 * Admin schválí KYC.
 */
export async function approveKyc(
  promoterId: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  const promoter = await getPromoterById(promoterId, deps);

  if (promoter.kycStatus !== 'submitted') {
    throw new PlatformError(
      'INVALID_STATUS_TRANSITION',
      `KYC cannot be approved from status '${promoter.kycStatus}'`,
    );
  }

  const newStatus: PromoterStatus = promoter.status === 'pending' ? 'active' : promoter.status;

  await db.execute(
    `UPDATE platform.promoters
     SET kyc_status = 'verified', kyc_verified_at = NOW(),
         status = $1, updated_at = NOW()
     WHERE id = $2`,
    [newStatus, promoterId],
  );

  await db.execute(
    `INSERT INTO platform.admin_actions (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, 'promoter.kyc.approve', 'promoter', $2, $3::jsonb)`,
    [adminUserId, promoterId, JSON.stringify({ previousKycStatus: promoter.kycStatus })],
  );

  kafka
    .send('promoter.kyc.approved', {
      promoterId,
      adminUserId,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {/* ignore */});

  if (newStatus === 'active' && promoter.status !== 'active') {
    kafka
      .send('promoter.activated', { promoterId, timestamp: new Date().toISOString() })
      .catch(() => {/* ignore */});
  }
}

/**
 * Admin zamítne KYC.
 */
export async function rejectKyc(
  promoterId: string,
  notes: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;

  const promoter = await getPromoterById(promoterId, deps);

  if (promoter.kycStatus !== 'submitted') {
    throw new PlatformError(
      'INVALID_STATUS_TRANSITION',
      `KYC cannot be rejected from status '${promoter.kycStatus}'`,
    );
  }

  await db.execute(
    `UPDATE platform.promoters
     SET kyc_status = 'rejected', kyc_notes = $1, updated_at = NOW()
     WHERE id = $2`,
    [notes, promoterId],
  );

  await db.execute(
    `INSERT INTO platform.admin_actions (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, 'promoter.kyc.reject', 'promoter', $2, $3::jsonb)`,
    [adminUserId, promoterId, JSON.stringify({ notes })],
  );
}

// ─── Admin správa promotérů ───────────────────────────────────────────────────

/**
 * Pozastaví promotéra.
 */
export async function suspendPromoter(
  promoterId: string,
  reason: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  const promoter = await getPromoterById(promoterId, deps);

  if (promoter.status !== 'active') {
    throw new PlatformError(
      'INVALID_STATUS_TRANSITION',
      `Cannot suspend promoter with status '${promoter.status}'`,
    );
  }

  await db.execute(
    `UPDATE platform.promoters SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
    [promoterId],
  );

  await db.execute(
    `INSERT INTO platform.admin_actions (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, 'promoter.suspend', 'promoter', $2, $3::jsonb)`,
    [adminUserId, promoterId, JSON.stringify({ reason })],
  );

  kafka
    .send('promoter.suspended', {
      promoterId,
      reason,
      adminUserId,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {/* ignore */});
}

/**
 * Reaktivuje pozastaveného promotéra.
 */
export async function activatePromoter(
  promoterId: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;

  const promoter = await getPromoterById(promoterId, deps);

  if (promoter.status !== 'suspended') {
    throw new PlatformError(
      'INVALID_STATUS_TRANSITION',
      `Cannot activate promoter with status '${promoter.status}'`,
    );
  }

  if (promoter.kycStatus !== 'verified') {
    throw new PlatformError('KYC_NOT_VERIFIED', 'KYC must be verified before activation');
  }

  await db.execute(
    `UPDATE platform.promoters SET status = 'active', updated_at = NOW() WHERE id = $1`,
    [promoterId],
  );

  await db.execute(
    `INSERT INTO platform.admin_actions (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, 'promoter.activate', 'promoter', $2, '{}'::jsonb)`,
    [adminUserId, promoterId],
  );
}

/**
 * Banuje promotéra.
 */
export async function banPromoter(
  promoterId: string,
  reason: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db, kafka } = deps;

  const promoter = await getPromoterById(promoterId, deps);

  if (promoter.status !== 'active' && promoter.status !== 'suspended') {
    throw new PlatformError(
      'INVALID_STATUS_TRANSITION',
      `Cannot ban promoter with status '${promoter.status}'`,
    );
  }

  await db.execute(
    `UPDATE platform.promoters SET status = 'banned', updated_at = NOW() WHERE id = $1`,
    [promoterId],
  );

  await db.execute(
    `INSERT INTO platform.admin_actions (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, 'promoter.ban', 'promoter', $2, $3::jsonb)`,
    [adminUserId, promoterId, JSON.stringify({ reason })],
  );

  kafka
    .send('promoter.banned', {
      promoterId,
      reason,
      adminUserId,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {/* ignore */});
}

/**
 * Paginated seznam promotérů pro admin.
 */
export async function listPromoters(
  filters: PromoterFilters,
  deps: ServiceDeps,
): Promise<{ items: PromoterAdmin[]; total: number }> {
  const { db } = deps;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }

  if (filters.kyc_status) {
    conditions.push(`kyc_status = $${idx++}`);
    params.push(filters.kyc_status);
  }

  if (filters.search) {
    conditions.push(
      `(name ILIKE $${idx} OR email ILIKE $${idx} OR ico ILIKE $${idx})`,
    );
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  const countRows = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM platform.promoters ${where}`,
    params,
  );

  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const rows = await db.query<PromoterRow>(
    `SELECT * FROM platform.promoters ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  return { items: rows.map(mapPromoterRow), total };
}

// ─── Správa členů týmu ────────────────────────────────────────────────────────

/**
 * Přidá člena do týmu promotéra.
 */
export async function addMember(
  promoterId: string,
  userId: string,
  role: MemberRole,
  invitedBy: string,
  deps: ServiceDeps,
): Promise<PromoterMember> {
  const { db } = deps;

  await assertMemberAccess(promoterId, invitedBy, ['owner', 'admin'], deps);

  // Kontrola duplicity (včetně deactivated — nelze znovu přidat)
  const existing = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM platform.promoter_members WHERE promoter_id = $1 AND user_id = $2`,
    [promoterId, userId],
  );

  if (existing.length > 0) {
    throw new PlatformError('MEMBER_ALREADY_EXISTS');
  }

  // Max 1 owner per promoter
  if (role === 'owner') {
    const owners = await db.query<{ id: string }>(
      `SELECT id FROM platform.promoter_members WHERE promoter_id = $1 AND role = 'owner' AND status != 'deactivated'`,
      [promoterId],
    );
    if (owners.length > 0) {
      throw new PlatformError('MEMBER_ALREADY_EXISTS', 'Promoter already has an owner');
    }
  }

  const rows = await db.query<MemberRow>(
    `INSERT INTO platform.promoter_members
       (promoter_id, user_id, role, invited_by, status, activated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW())
     RETURNING *`,
    [promoterId, userId, role, invitedBy],
  );

  return mapMemberRow(rows[0]);
}

/**
 * Změní roli člena. Vyžaduje role='owner' requestera.
 */
export async function updateMemberRole(
  promoterId: string,
  memberId: string,
  newRole: MemberRole,
  requesterId: string,
  deps: ServiceDeps,
): Promise<PromoterMember> {
  const { db } = deps;

  await assertMemberAccess(promoterId, requesterId, ['owner'], deps);

  const memberRows = await db.query<MemberRow>(
    `SELECT * FROM platform.promoter_members WHERE id = $1 AND promoter_id = $2 AND status != 'deactivated'`,
    [memberId, promoterId],
  );

  if (memberRows.length === 0) {
    throw new PlatformError('MEMBER_NOT_FOUND');
  }

  const member = memberRows[0];

  if (member.role === 'owner') {
    throw new PlatformError('INVALID_STATUS_TRANSITION', 'Cannot change role of owner');
  }

  const rows = await db.query<MemberRow>(
    `UPDATE platform.promoter_members SET role = $1 WHERE id = $2 RETURNING *`,
    [newRole, memberId],
  );

  return mapMemberRow(rows[0]);
}

/**
 * Odebere (soft delete) člena z týmu.
 */
export async function removeMember(
  promoterId: string,
  memberId: string,
  requesterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps;

  await assertMemberAccess(promoterId, requesterId, ['owner', 'admin'], deps);

  const memberRows = await db.query<MemberRow>(
    `SELECT * FROM platform.promoter_members WHERE id = $1 AND promoter_id = $2 AND status != 'deactivated'`,
    [memberId, promoterId],
  );

  if (memberRows.length === 0) {
    throw new PlatformError('MEMBER_NOT_FOUND');
  }

  if (memberRows[0].role === 'owner') {
    throw new PlatformError('CANNOT_REMOVE_OWNER');
  }

  await db.execute(
    `UPDATE platform.promoter_members
     SET status = 'deactivated', deactivated_at = NOW()
     WHERE id = $1`,
    [memberId],
  );
}

/**
 * Helper: ověří že userId je aktivní člen promotéra s jednou z požadovaných rolí.
 * Anti-enumeration: vždy hodí UNAUTHORIZED (statusCode=404) pokud nevyhovuje.
 */
export async function assertMemberAccess(
  promoterId: string,
  userId: string,
  requiredRoles: MemberRole[],
  deps: ServiceDeps,
): Promise<PromoterMember> {
  const { db } = deps;

  const rows = await db.query<MemberRow>(
    `SELECT * FROM platform.promoter_members
     WHERE promoter_id = $1 AND user_id = $2 AND status = 'active'`,
    [promoterId, userId],
  );

  if (rows.length === 0) {
    throw new PlatformError('UNAUTHORIZED');
  }

  const member = rows[0];

  if (!requiredRoles.includes(member.role)) {
    throw new PlatformError('UNAUTHORIZED');
  }

  return mapMemberRow(member);
}

/**
 * Vrátí seznam členů promotéra.
 */
export async function listMembers(
  promoterId: string,
  requesterId: string,
  deps: ServiceDeps,
): Promise<PromoterMember[]> {
  const { db } = deps;

  await assertMemberAccess(
    promoterId,
    requesterId,
    ['owner', 'admin', 'manager', 'finance', 'marketing', 'staff', 'gate'],
    deps,
  );

  const rows = await db.query<MemberRow>(
    `SELECT * FROM platform.promoter_members
     WHERE promoter_id = $1 AND status != 'deactivated'
     ORDER BY created_at ASC`,
    [promoterId],
  );

  return rows.map(mapMemberRow);
}

// ─── Fee schedule ─────────────────────────────────────────────────────────────

/**
 * Vytvoří fee schedule pro promotéra (admin).
 */
export async function createFeeSchedule(
  promoterId: string,
  input: CreateFeeScheduleInput,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<FeeSchedule> {
  const { db } = deps;

  // Verify promoter exists
  await getPromoterById(promoterId, deps);

  const rows = await db.query<FeeScheduleRow>(
    `INSERT INTO platform.fee_schedules
       (promoter_id, name, percentage_fee, fixed_fee, min_fee, max_fee, valid_from, valid_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      promoterId,
      input.name ?? 'default',
      input.percentageFee,
      input.fixedFee,
      input.minFee ?? null,
      input.maxFee ?? null,
      input.validFrom ?? new Date().toISOString(),
      input.validUntil ?? null,
    ],
  );

  await db.execute(
    `INSERT INTO platform.admin_actions (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, 'fee_schedule.create', 'promoter', $2, $3::jsonb)`,
    [adminUserId, promoterId, JSON.stringify({ feeScheduleId: rows[0].id })],
  );

  return mapFeeRow(rows[0]);
}

/**
 * Vypočítá fee pro vstupenku. Výsledek je vždy INTEGER haléře.
 * - result = Math.round(ticketPrice * percentageFee / 10000) + fixedFee
 * - aplicuj min/max
 */
export function calculateFee(ticketPrice: number, schedule: FeeSchedule): number {
  let fee = Math.round((ticketPrice * schedule.percentageFee) / 10000) + schedule.fixedFee;

  if (schedule.minFee !== null) {
    fee = Math.max(schedule.minFee, fee);
  }

  if (schedule.maxFee !== null) {
    fee = Math.min(schedule.maxFee, fee);
  }

  return fee;
}
