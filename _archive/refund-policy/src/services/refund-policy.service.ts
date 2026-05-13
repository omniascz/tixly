import { RefundError } from '../lib/refund-errors';
import { ServiceDeps } from '../lib/service-container';
import {
  CreatePolicyInput,
  UpdatePolicyInput,
  createPolicySchema,
  updatePolicySchema,
} from '../lib/zod-schemas';
import {
  RefundPolicy,
  RefundPolicyTier,
  RefundEligibility,
  RefundMethod,
} from '../types/refund';
import { withTenantContext } from '@tixly/rls-multitenancy';

// ------------------------------------------------------------------ //
// TenantContext
// ------------------------------------------------------------------ //

export type TenantContext = {
  promoterId?: string;
  userId?: string;
  role: 'service' | 'admin' | 'promoter' | 'buyer';
};


// ------------------------------------------------------------------ //
// DB row shapes
// ------------------------------------------------------------------ //

interface DbRefundPolicy {
  id: string;
  promoter_id: string;
  name: string;
  policy_type: string;
  refund_percentage: number | null;
  refund_method: string;
  allow_self_service: boolean;
  min_days_before_event: number | null;
  max_days_after_purchase: number | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface DbRefundPolicyTier {
  id: string;
  policy_id: string;
  min_days_before: number;
  refund_pct: number;
  label: string | null;
  sort_order: number;
}

// ------------------------------------------------------------------ //
// Mappers
// ------------------------------------------------------------------ //

function mapTier(row: DbRefundPolicyTier): RefundPolicyTier {
  return {
    id: row.id,
    minDaysBefore: row.min_days_before,
    refundPct: row.refund_pct,
    label: row.label,
    sortOrder: row.sort_order,
  };
}

function mapPolicy(row: DbRefundPolicy, tiers: RefundPolicyTier[]): RefundPolicy {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    policyType: row.policy_type as RefundPolicy['policyType'],
    refundPercentage: row.refund_percentage,
    refundMethod: row.refund_method as RefundMethod,
    allowSelfService: row.allow_self_service,
    minDaysBeforeEvent: row.min_days_before_event,
    maxDaysAfterPurchase: row.max_days_after_purchase,
    isDefault: row.is_default,
    isActive: row.is_active,
    tiers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

async function loadTiersForPolicy(
  policyId: string,
  db: ServiceDeps['db'],
): Promise<RefundPolicyTier[]> {
  const rows = await db.query<DbRefundPolicyTier>(
    `SELECT id, policy_id, min_days_before, refund_pct, label, sort_order
       FROM platform.refund_policy_tiers
      WHERE policy_id = $1
      ORDER BY min_days_before DESC`,
    [policyId],
  );
  return rows.map(mapTier);
}

async function loadPolicyWithTiers(
  policyId: string,
  db: ServiceDeps['db'],
): Promise<RefundPolicy | null> {
  const rows = await db.query<DbRefundPolicy>(
    `SELECT id, promoter_id, name, policy_type, refund_percentage, refund_method,
            allow_self_service, min_days_before_event, max_days_after_purchase,
            is_default, is_active, created_at, updated_at
       FROM platform.refund_policies
      WHERE id = $1`,
    [policyId],
  );
  if (rows.length === 0) return null;
  const tiers = await loadTiersForPolicy(policyId, db);
  return mapPolicy(rows[0], tiers);
}

// Find tier that applies for given daysUntilEvent.
// Tiers are sorted by min_days_before DESC. We find the highest min_days_before
// that is <= daysUntilEvent.
function findApplicableTier(
  tiers: RefundPolicyTier[],
  daysUntilEvent: number,
): RefundPolicyTier | null {
  // Sort descending by minDaysBefore (already done in query, but defensive)
  const sorted = [...tiers].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  for (const tier of sorted) {
    if (daysUntilEvent >= tier.minDaysBefore) {
      return tier;
    }
  }
  return null;
}

// ------------------------------------------------------------------ //
// Service
// ------------------------------------------------------------------ //

export async function createPolicy(
  promoterId: string,
  rawInput: unknown,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<RefundPolicy> {
  const input: CreatePolicyInput = createPolicySchema.parse(rawInput);

  return withTenantContext(deps.db, context, async (db) => db.transaction(async (tx) => {
    // Deaktivuj předchozí default v rámci transakce (DEFERRABLE pomůže)
    if (input.isDefault) {
      await tx.execute(
        `UPDATE platform.refund_policies
            SET is_default = FALSE, updated_at = NOW()
          WHERE promoter_id = $1 AND is_default = TRUE`,
        [promoterId],
      );
    }

    const [row] = await tx.query<DbRefundPolicy>(
      `INSERT INTO platform.refund_policies
         (promoter_id, name, policy_type, refund_percentage, refund_method,
          allow_self_service, min_days_before_event, max_days_after_purchase,
          is_default, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       RETURNING *`,
      [
        promoterId,
        input.name,
        input.policyType,
        input.refundPercentage ?? null,
        input.refundMethod,
        input.allowSelfService,
        input.minDaysBeforeEvent ?? null,
        input.maxDaysAfterPurchase ?? null,
        input.isDefault,
      ],
    );

    const tiers: RefundPolicyTier[] = [];

    if (input.tiers && input.tiers.length > 0) {
      for (let i = 0; i < input.tiers.length; i++) {
        const t = input.tiers[i];
        const [tierRow] = await tx.query<DbRefundPolicyTier>(
          `INSERT INTO platform.refund_policy_tiers
             (policy_id, min_days_before, refund_pct, label, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [row.id, t.minDaysBefore, t.refundPct, t.label ?? null, t.sortOrder ?? i],
        );
        tiers.push(mapTier(tierRow));
      }
    }

    const policy = mapPolicy(row, tiers);

    deps.kafka
      .send('refund_policy.created', { policyId: policy.id, promoterId })
      .catch(() => {});

    return policy;
  })); // end withTenantContext + transaction
}

export async function updatePolicy(
  policyId: string,
  promoterId: string,
  rawInput: unknown,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<RefundPolicy> {
  const input: UpdatePolicyInput = updatePolicySchema.parse(rawInput);

  return withTenantContext(deps.db, context, async (db) => db.transaction(async (tx) => {
    // Ownership check — returns 404 on missing or wrong owner (anti-enumeration)
    const existingRows = await tx.query<DbRefundPolicy>(
      `SELECT id, promoter_id, policy_type, refund_percentage,
              name, refund_method, allow_self_service, min_days_before_event,
              max_days_after_purchase, is_default, is_active, created_at, updated_at
         FROM platform.refund_policies
        WHERE id = $1 AND promoter_id = $2`,
      [policyId, promoterId],
    );
    if (existingRows.length === 0) {
      throw new RefundError('POLICY_NOT_FOUND');
    }

    const cur = existingRows[0];

    // Resolve effective policy type & percentage for validation
    const effectivePolicyType = input.policyType ?? cur.policy_type;
    const effectivePercentage =
      input.refundPercentage !== undefined ? input.refundPercentage : cur.refund_percentage;

    if (effectivePolicyType === 'partial_refund' && effectivePercentage == null) {
      throw new RefundError('INVALID_AMOUNT', 'refundPercentage je povinné pro partial_refund');
    }

    if (input.isDefault === true) {
      await tx.execute(
        `UPDATE platform.refund_policies
            SET is_default = FALSE, updated_at = NOW()
          WHERE promoter_id = $1 AND is_default = TRUE AND id != $2`,
        [promoterId, policyId],
      );
    }

    const [updatedRow] = await tx.query<DbRefundPolicy>(
      `UPDATE platform.refund_policies
          SET name                   = COALESCE($1, name),
              policy_type            = COALESCE($2, policy_type),
              refund_percentage      = CASE WHEN $3::boolean THEN $4 ELSE refund_percentage END,
              refund_method          = COALESCE($5, refund_method),
              allow_self_service     = COALESCE($6, allow_self_service),
              min_days_before_event  = CASE WHEN $7::boolean THEN $8 ELSE min_days_before_event END,
              max_days_after_purchase= CASE WHEN $9::boolean THEN $10 ELSE max_days_after_purchase END,
              is_default             = COALESCE($11, is_default),
              is_active              = COALESCE($12, is_active),
              updated_at             = NOW()
        WHERE id = $13
        RETURNING *`,
      [
        input.name ?? null,
        input.policyType ?? null,
        'refundPercentage' in input,
        input.refundPercentage ?? null,
        input.refundMethod ?? null,
        input.allowSelfService ?? null,
        'minDaysBeforeEvent' in input,
        input.minDaysBeforeEvent ?? null,
        'maxDaysAfterPurchase' in input,
        input.maxDaysAfterPurchase ?? null,
        input.isDefault ?? null,
        input.isActive ?? null,
        policyId,
      ],
    );

    let tiers: RefundPolicyTier[] = [];

    if (input.tiers !== undefined) {
      await tx.execute(
        `DELETE FROM platform.refund_policy_tiers WHERE policy_id = $1`,
        [policyId],
      );

      for (let i = 0; i < input.tiers.length; i++) {
        const t = input.tiers[i];
        const [tierRow] = await tx.query<DbRefundPolicyTier>(
          `INSERT INTO platform.refund_policy_tiers
             (policy_id, min_days_before, refund_pct, label, sort_order)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [policyId, t.minDaysBefore, t.refundPct, t.label ?? null, t.sortOrder ?? i],
        );
        tiers.push(mapTier(tierRow));
      }
    } else {
      tiers = await loadTiersForPolicy(policyId, tx);
    }

    return mapPolicy(updatedRow, tiers);
  })); // end withTenantContext + transaction
}

export async function setEventOverride(
  eventId: string,
  promoterId: string,
  policyId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<void> {
  return withTenantContext(deps.db, context, async (db) => {
  // Ověř, že policy patří promotérovi (anti-enumeration → 404)
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM platform.refund_policies
      WHERE id = $1 AND promoter_id = $2 AND is_active = TRUE`,
    [policyId, promoterId],
  );
  if (rows.length === 0) {
    throw new RefundError('POLICY_NOT_FOUND');
  }

  await db.execute(
    `INSERT INTO platform.event_refund_overrides (event_id, promoter_id, policy_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (event_id) DO UPDATE
       SET policy_id = EXCLUDED.policy_id,
           promoter_id = EXCLUDED.promoter_id`,
    [eventId, promoterId, policyId],
  );
  }); // end withTenantContext
}

export async function checkRefundEligibility(
  orderId: string,
  ticketId: string | null,
  eventDate: Date,
  purchasedAt: Date,
  orderAmount: number,
  promoterId: string,
  eventId: string | null,
  deps: ServiceDeps,
  context: TenantContext = { role: 'service' },
): Promise<RefundEligibility> {
  return withTenantContext(deps.db, context, async (db) => {
  // Najdi aktivní policy: nejprve event override, pak default
  let policy: RefundPolicy | null = null;

  if (eventId) {
    const overrideRows = await db.query<{ policy_id: string }>(
      `SELECT policy_id FROM platform.event_refund_overrides
        WHERE event_id = $1 AND promoter_id = $2`,
      [eventId, promoterId],
    );
    if (overrideRows.length > 0) {
      policy = await loadPolicyWithTiers(overrideRows[0].policy_id, db);
    }
  }

  if (!policy) {
    const defaultRows = await db.query<DbRefundPolicy>(
      `SELECT id, promoter_id, name, policy_type, refund_percentage, refund_method,
              allow_self_service, min_days_before_event, max_days_after_purchase,
              is_default, is_active, created_at, updated_at
         FROM platform.refund_policies
        WHERE promoter_id = $1 AND is_default = TRUE AND is_active = TRUE
        LIMIT 1`,
      [promoterId],
    );
    if (defaultRows.length === 0) {
      throw new RefundError('POLICY_NOT_FOUND', 'Žádná aktivní politika refundací nebyla nalezena');
    }
    const tiers = await loadTiersForPolicy(defaultRows[0].id, db);
    policy = mapPolicy(defaultRows[0], tiers);
  }

  const now = Date.now();
  const daysUntilEvent = Math.ceil((eventDate.getTime() - now) / 86_400_000);
  const daysSincePurchase = Math.ceil((now - purchasedAt.getTime()) / 86_400_000);

  const baseResult: Omit<RefundEligibility, 'eligible' | 'refundableAmount' | 'reason' | 'code' | 'appliedTier'> = {
    refundMethod: policy.policyType === 'credit_only' ? 'platform_credit' : policy.refundMethod,
    requiresRequest: !policy.allowSelfService,
    policyId: policy.id,
  };

  // no_refund
  if (policy.policyType === 'no_refund') {
    return {
      ...baseResult,
      eligible: false,
      refundableAmount: 0,
      reason: 'Tato akce neumožňuje refundace',
      code: 'POLICY_NO_REFUND',
      appliedTier: null,
    };
  }

  // minDaysBeforeEvent check
  if (policy.minDaysBeforeEvent != null && daysUntilEvent < policy.minDaysBeforeEvent) {
    return {
      ...baseResult,
      eligible: false,
      refundableAmount: 0,
      reason: 'Lhůta pro refundaci uplynula',
      code: 'DEADLINE_PASSED',
      appliedTier: null,
    };
  }

  // maxDaysAfterPurchase check
  if (policy.maxDaysAfterPurchase != null && daysSincePurchase > policy.maxDaysAfterPurchase) {
    return {
      ...baseResult,
      eligible: false,
      refundableAmount: 0,
      reason: 'Uplynula lhůta od nákupu',
      code: 'PURCHASE_WINDOW_EXPIRED',
      appliedTier: null,
    };
  }

  // Výpočet refundableAmount
  let refundableAmount: number;
  let appliedTier: RefundPolicyTier | null = null;

  switch (policy.policyType) {
    case 'full_refund':
    case 'credit_only':
      refundableAmount = orderAmount;
      break;

    case 'partial_refund': {
      const pct = policy.refundPercentage ?? 0;
      refundableAmount = Math.round((orderAmount * pct) / 10_000);
      break;
    }

    case 'tiered_refund': {
      const tier = findApplicableTier(policy.tiers, daysUntilEvent);
      if (!tier || tier.refundPct === 0) {
        return {
          ...baseResult,
          eligible: false,
          refundableAmount: 0,
          reason: 'Lhůta pro refundaci uplynula',
          code: 'DEADLINE_PASSED',
          appliedTier: tier,
        };
      }
      appliedTier = tier;
      refundableAmount = Math.round((orderAmount * tier.refundPct) / 10_000);
      break;
    }

    default:
      refundableAmount = 0;
  }

  return {
    ...baseResult,
    eligible: true,
    refundableAmount,
    reason: null,
    code: null,
    appliedTier,
  };
  }); // end withTenantContext
}

export async function getDefaultPolicy(
  promoterId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<RefundPolicy> {
  return withTenantContext(deps.db, context, async (db) => {
  const rows = await db.query<DbRefundPolicy>(
    `SELECT id, promoter_id, name, policy_type, refund_percentage, refund_method,
            allow_self_service, min_days_before_event, max_days_after_purchase,
            is_default, is_active, created_at, updated_at
       FROM platform.refund_policies
      WHERE promoter_id = $1 AND is_default = TRUE AND is_active = TRUE
      LIMIT 1`,
    [promoterId],
  );
  if (rows.length === 0) {
    throw new RefundError('POLICY_NOT_FOUND');
  }
  const tiers = await loadTiersForPolicy(rows[0].id, db);
  return mapPolicy(rows[0], tiers);
  }); // end withTenantContext
}

export async function getPolicyById(
  policyId: string,
  promoterId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<RefundPolicy> {
  return withTenantContext(deps.db, context, async (db) => {
  const rows = await db.query<DbRefundPolicy>(
    `SELECT id, promoter_id, name, policy_type, refund_percentage, refund_method,
            allow_self_service, min_days_before_event, max_days_after_purchase,
            is_default, is_active, created_at, updated_at
       FROM platform.refund_policies
      WHERE id = $1 AND promoter_id = $2`,
    [policyId, promoterId],
  );
  if (rows.length === 0) {
    throw new RefundError('POLICY_NOT_FOUND');
  }
  const tiers = await loadTiersForPolicy(policyId, db);
  return mapPolicy(rows[0], tiers);
  }); // end withTenantContext
}

export async function listPolicies(
  promoterId: string,
  deps: ServiceDeps,
  context: TenantContext = { role: 'promoter', promoterId },
): Promise<RefundPolicy[]> {
  return withTenantContext(deps.db, context, async (db) => {
  const rows = await db.query<DbRefundPolicy>(
    `SELECT id, promoter_id, name, policy_type, refund_percentage, refund_method,
            allow_self_service, min_days_before_event, max_days_after_purchase,
            is_default, is_active, created_at, updated_at
       FROM platform.refund_policies
      WHERE promoter_id = $1
      ORDER BY is_default DESC, created_at ASC`,
    [promoterId],
  );

  return Promise.all(
    rows.map(async (row) => {
      const tiers = await loadTiersForPolicy(row.id, db);
      return mapPolicy(row, tiers);
    }),
  );
  }); // end withTenantContext
}
