// =============================================================================
// Fraud Queue Service
//
// Odpovědnosti:
//   1. enqueueFraudCase      — zavolat z checkout pipeline když risk_score >= práh
//   2. listFraudQueue        — seznam případů pro admin dashboard
//   3. getFraudCase          — detail jednoho případu včetně reviews
//   4. reviewFraudCase       — rozhodnutí admina (clear / confirm_fraud / escalate / add_note)
//   5. getFraudStats         — agregované statistiky pro dashboard
// =============================================================================

import { FraudError } from '../lib/fraud-errors';

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

export interface FraudSignal {
  rule: string;      // viz risk.fraud_rules.rule_name
  detail: string;    // lidsky čitelný popis
  score: number;     // příspěvek k celkovému risk_score
}

export interface EnqueueInput {
  orderId: string;
  userId: string;
  promoterId?: string;
  eventId?: string;
  amountHellers: number;
  currency?: string;
  riskScore: number;
  signals: FraudSignal[];
  ipAddress?: string;
  userAgent?: string;
  countryCode?: string;
  orderHeld?: boolean;  // zda byl order automaticky pozastaven
  sourceModule?: string;   // 'device-fingerprinting' | 'bank-reconciliation' | 'gopay-payments' | ...
  sourceRefId?: string;    // idempotency reference within source module
}

// SLA deadline hours by severity/priority
const SLA_HOURS_BY_PRIORITY: Record<string, number> = {
  critical: 2,
  high:     6,
  normal:   24,
  low:      72,
};

export function computeSlaDeadline(priority: string, now: Date = new Date()): Date {
  const hours = SLA_HOURS_BY_PRIORITY[priority] ?? SLA_HOURS_BY_PRIORITY.normal;
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export type ReviewDecision = 'clear' | 'confirm_fraud' | 'escalate' | 'add_note';

export interface ReviewInput {
  decision: ReviewDecision;
  notes?: string;
  banBuyer?: boolean;  // pouze pro confirm_fraud
}

export interface FraudCaseSummary {
  id: string;
  orderId: string;
  userId: string;
  promoterId: string | null;
  amountHellers: number;
  currency: string;
  riskScore: number;
  signals: FraudSignal[];
  status: string;
  priority: string;
  orderHeld: boolean;
  countryCode: string | null;
  createdAt: string;
}

export interface FraudCaseDetail extends FraudCaseSummary {
  eventId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviews: FraudReviewRecord[];
}

export interface FraudReviewRecord {
  id: string;
  adminUserId: string;
  decision: ReviewDecision;
  notes: string | null;
  banBuyer: boolean;
  createdAt: string;
}

export interface FraudQueueFilters {
  status?: string;    // pending_review | cleared | confirmed_fraud | escalated
  priority?: string;  // low | normal | high | critical
  minScore?: number;
  limit: number;
  offset: number;
}

export interface FraudStats {
  pendingReview: number;
  resolvedToday: number;
  confirmedFraudToday: number;
  clearedToday: number;
  avgRiskScore: number | null;
  totalHeldHellers: number;  // celková hodnota objednávek v hold
}

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

interface FraudDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Kafka / event bus adapter
// ---------------------------------------------------------------------------

interface EventBus {
  send(topic: string, payload: Record<string, unknown>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface FraudDeps {
  db: FraudDB;
  eventBus: EventBus;
}

// ---------------------------------------------------------------------------
// 1. Enqueue
// ---------------------------------------------------------------------------

const ENQUEUE_PRIORITY_THRESHOLD_CRITICAL = 80;
const ENQUEUE_PRIORITY_THRESHOLD_HIGH = 60;

export async function enqueueFraudCase(
  input: EnqueueInput,
  deps: FraudDeps,
): Promise<{ caseId: string }> {
  // Kontrola duplicity order
  const [existing] = await deps.db.query<{ id: string }>(
    `SELECT id FROM risk.fraud_cases WHERE order_id = $1`,
    [input.orderId],
  );
  if (existing) {
    throw new FraudError('DUPLICATE_ORDER');
  }

  // Dedup by source_module + source_ref_id (idempotency pro push z jiných modulů)
  if (input.sourceModule && input.sourceRefId) {
    const [dupSource] = await deps.db.query<{ id: string }>(
      `SELECT id FROM risk.fraud_cases
       WHERE source_module = $1 AND source_ref_id = $2`,
      [input.sourceModule, input.sourceRefId],
    );
    if (dupSource) {
      throw new FraudError('DUPLICATE_SOURCE_REF');
    }
  }

  const priority =
    input.riskScore >= ENQUEUE_PRIORITY_THRESHOLD_CRITICAL
      ? 'critical'
      : input.riskScore >= ENQUEUE_PRIORITY_THRESHOLD_HIGH
        ? 'high'
        : 'normal';

  const slaDeadline = computeSlaDeadline(priority);

  const [row] = await deps.db.query<{ id: string }>(
    `INSERT INTO risk.fraud_cases
       (order_id, user_id, promoter_id, event_id,
        amount_hellers, currency, risk_score, signals,
        priority, order_held, ip_address, user_agent, country_code,
        source_module, source_ref_id, sla_deadline_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::inet,$12,$13,$14,$15,$16)
     RETURNING id`,
    [
      input.orderId,
      input.userId,
      input.promoterId ?? null,
      input.eventId ?? null,
      input.amountHellers,
      input.currency ?? 'CZK',
      input.riskScore,
      JSON.stringify(input.signals),
      priority,
      input.orderHeld ?? false,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.countryCode ?? null,
      input.sourceModule ?? null,
      input.sourceRefId ?? null,
      slaDeadline.toISOString(),
    ],
  );

  deps.eventBus
    .send('risk.fraud_case.created', {
      caseId: row.id,
      orderId: input.orderId,
      riskScore: input.riskScore,
      priority,
      orderHeld: input.orderHeld ?? false,
    })
    .catch(() => {});

  return { caseId: row.id };
}

// ---------------------------------------------------------------------------
// 2. List queue
// ---------------------------------------------------------------------------

export async function listFraudQueue(
  filters: FraudQueueFilters,
  deps: FraudDeps,
): Promise<{ items: FraudCaseSummary[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx}`);
    params.push(filters.status);
    idx++;
  } else {
    // Default: zobraz všechny pending
    conditions.push(`status = 'pending_review'`);
  }

  if (filters.priority) {
    conditions.push(`priority = $${idx}`);
    params.push(filters.priority);
    idx++;
  }

  if (filters.minScore !== undefined) {
    conditions.push(`risk_score >= $${idx}`);
    params.push(filters.minScore);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await deps.db.query<{
    id: string; order_id: string; user_id: string; promoter_id: string | null;
    amount_hellers: number; currency: string; risk_score: number;
    signals: unknown; status: string; priority: string; order_held: boolean;
    country_code: string | null; created_at: string;
  }>(
    `SELECT id, order_id, user_id, promoter_id, amount_hellers, currency,
            risk_score, signals, status, priority, order_held, country_code, created_at
     FROM risk.fraud_cases
     ${where}
     ORDER BY priority DESC, risk_score DESC, created_at ASC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, filters.limit, filters.offset],
  );

  const [countRow] = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM risk.fraud_cases ${where}`,
    params,
  );

  return {
    items: rows.map(mapToSummary),
    total: parseInt(countRow?.count ?? '0', 10),
  };
}

// ---------------------------------------------------------------------------
// 3. Get detail
// ---------------------------------------------------------------------------

export async function getFraudCase(
  caseId: string,
  deps: FraudDeps,
): Promise<FraudCaseDetail> {
  const [row] = await deps.db.query<{
    id: string; order_id: string; user_id: string; promoter_id: string | null;
    event_id: string | null; amount_hellers: number; currency: string;
    risk_score: number; signals: unknown; status: string; priority: string;
    order_held: boolean; ip_address: string | null; user_agent: string | null;
    country_code: string | null; reviewed_by: string | null;
    reviewed_at: string | null; created_at: string;
  }>(
    `SELECT id, order_id, user_id, promoter_id, event_id, amount_hellers, currency,
            risk_score, signals, status, priority, order_held,
            ip_address, user_agent, country_code,
            reviewed_by, reviewed_at, created_at
     FROM risk.fraud_cases WHERE id = $1`,
    [caseId],
  );

  if (!row) {
    throw new FraudError('CASE_NOT_FOUND');
  }

  const reviewRows = await deps.db.query<{
    id: string; admin_user_id: string; decision: string;
    notes: string | null; ban_buyer: boolean; created_at: string;
  }>(
    `SELECT id, admin_user_id, decision, notes, ban_buyer, created_at
     FROM risk.fraud_reviews WHERE case_id = $1
     ORDER BY created_at ASC`,
    [caseId],
  );

  return {
    ...mapToSummary(row),
    eventId: row.event_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviews: reviewRows.map((r) => ({
      id: r.id,
      adminUserId: r.admin_user_id,
      decision: r.decision as ReviewDecision,
      notes: r.notes,
      banBuyer: r.ban_buyer,
      createdAt: r.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. Review
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['cleared', 'confirmed_fraud']);

export async function reviewFraudCase(
  caseId: string,
  adminUserId: string,
  input: ReviewInput,
  deps: FraudDeps,
): Promise<void> {
  const [caseRow] = await deps.db.query<{ id: string; status: string; order_id: string; user_id: string }>(
    `SELECT id, status, order_id, user_id FROM risk.fraud_cases WHERE id = $1`,
    [caseId],
  );

  if (!caseRow) {
    throw new FraudError('CASE_NOT_FOUND');
  }

  if (TERMINAL_STATUSES.has(caseRow.status)) {
    throw new FraudError('CASE_ALREADY_RESOLVED');
  }

  if (
    (input.decision === 'confirm_fraud' || input.decision === 'escalate') &&
    (!input.notes || input.notes.trim().length < 5)
  ) {
    throw new FraudError('NOTES_REQUIRED');
  }

  // Nový stav
  const newStatus: Record<ReviewDecision, string> = {
    clear:          'cleared',
    confirm_fraud:  'confirmed_fraud',
    escalate:       'escalated',
    add_note:       caseRow.status, // stav se nemění
  };

  const newPriority = input.decision === 'escalate' ? 'critical' : undefined;

  // Update case
  if (newPriority) {
    await deps.db.execute(
      `UPDATE risk.fraud_cases
       SET status = $1, priority = $2, reviewed_by = $3, reviewed_at = NOW()
       WHERE id = $4`,
      [newStatus[input.decision], newPriority, adminUserId, caseId],
    );
  } else {
    await deps.db.execute(
      `UPDATE risk.fraud_cases
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      [newStatus[input.decision], adminUserId, caseId],
    );
  }

  // Audit review
  await deps.db.execute(
    `INSERT INTO risk.fraud_reviews (case_id, admin_user_id, decision, notes, ban_buyer)
     VALUES ($1, $2, $3, $4, $5)`,
    [caseId, adminUserId, input.decision, input.notes ?? null, input.banBuyer ?? false],
  );

  // Audit trail state transition
  await deps.db.execute(
    `INSERT INTO risk.fraud_case_audit (case_id, actor_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [caseId, adminUserId, caseRow.status, newStatus[input.decision], input.notes ?? null],
  );

  // Downstream akce
  if (input.decision === 'clear') {
    deps.eventBus
      .send('risk.fraud_case.cleared', { caseId, orderId: caseRow.order_id, adminUserId })
      .catch(() => {});
  } else if (input.decision === 'confirm_fraud') {
    deps.eventBus
      .send('risk.fraud_case.confirmed', {
        caseId,
        orderId: caseRow.order_id,
        userId: caseRow.user_id,
        adminUserId,
        banBuyer: input.banBuyer ?? false,
      })
      .catch(() => {});
  } else if (input.decision === 'escalate') {
    deps.eventBus
      .send('risk.fraud_case.escalated', { caseId, orderId: caseRow.order_id, adminUserId })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 5. Stats
// ---------------------------------------------------------------------------

export async function getFraudStats(deps: FraudDeps): Promise<FraudStats> {
  const [pendingRow] = await deps.db.query<{ count: string; total_held: string }>(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(amount_hellers) FILTER (WHERE order_held = TRUE), 0) AS total_held
     FROM risk.fraud_cases
     WHERE status = 'pending_review'`,
  );

  const [todayRow] = await deps.db.query<{
    resolved: string;
    confirmed: string;
    cleared: string;
    avg_score: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('cleared','confirmed_fraud')) AS resolved,
       COUNT(*) FILTER (WHERE status = 'confirmed_fraud')             AS confirmed,
       COUNT(*) FILTER (WHERE status = 'cleared')                     AS cleared,
       ROUND(AVG(risk_score) FILTER (WHERE status = 'pending_review'), 1) AS avg_score
     FROM risk.fraud_cases
     WHERE DATE(created_at) = CURRENT_DATE
        OR (reviewed_at IS NOT NULL AND DATE(reviewed_at) = CURRENT_DATE)`,
  );

  return {
    pendingReview: parseInt(pendingRow?.count ?? '0', 10),
    resolvedToday: parseInt(todayRow?.resolved ?? '0', 10),
    confirmedFraudToday: parseInt(todayRow?.confirmed ?? '0', 10),
    clearedToday: parseInt(todayRow?.cleared ?? '0', 10),
    avgRiskScore: todayRow?.avg_score ? parseFloat(todayRow.avg_score) : null,
    totalHeldHellers: parseInt(pendingRow?.total_held ?? '0', 10),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 6. Claim mechanism
// ---------------------------------------------------------------------------

export const CLAIM_LOCK_MINUTES = 30;

export async function claimCase(
  caseId: string,
  csUserId: string,
  deps: FraudDeps,
): Promise<void> {
  const [row] = await deps.db.query<{
    id: string; status: string; claimed_by_user_id: string | null; claimed_at: string | null;
  }>(
    `SELECT id, status, claimed_by_user_id, claimed_at
     FROM risk.fraud_cases WHERE id = $1`,
    [caseId],
  );

  if (!row) throw new FraudError('CASE_NOT_FOUND');
  if (TERMINAL_STATUSES.has(row.status)) throw new FraudError('CASE_ALREADY_RESOLVED');

  if (row.claimed_by_user_id && row.claimed_by_user_id !== csUserId && row.claimed_at) {
    const claimedAtMs = new Date(row.claimed_at).getTime();
    const ageMinutes = (Date.now() - claimedAtMs) / 60000;
    if (ageMinutes < CLAIM_LOCK_MINUTES) {
      throw new FraudError('CASE_ALREADY_CLAIMED');
    }
  }

  await deps.db.execute(
    `UPDATE risk.fraud_cases
     SET claimed_by_user_id = $1, claimed_at = NOW(),
         status = CASE WHEN status = 'pending_review' THEN 'reviewing' ELSE status END
     WHERE id = $2`,
    [csUserId, caseId],
  );

  await deps.db.execute(
    `INSERT INTO risk.fraud_case_audit (case_id, actor_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [caseId, csUserId, row.status, row.status === 'pending_review' ? 'reviewing' : row.status, 'claimed'],
  );
}

// ---------------------------------------------------------------------------
// 7. Escalate (unified) — bumps severity to critical + Kafka notify
// ---------------------------------------------------------------------------

export async function escalateCase(
  caseId: string,
  reason: string,
  csUserId: string,
  deps: FraudDeps,
): Promise<void> {
  if (!reason || reason.trim().length < 5) {
    throw new FraudError('NOTES_REQUIRED');
  }

  const [row] = await deps.db.query<{ id: string; status: string; order_id: string; priority: string }>(
    `SELECT id, status, order_id, priority FROM risk.fraud_cases WHERE id = $1`,
    [caseId],
  );
  if (!row) throw new FraudError('CASE_NOT_FOUND');
  if (TERMINAL_STATUSES.has(row.status)) throw new FraudError('CASE_ALREADY_RESOLVED');

  await deps.db.execute(
    `UPDATE risk.fraud_cases
     SET status = 'escalated', priority = 'critical', reviewed_by = $1, reviewed_at = NOW()
     WHERE id = $2`,
    [csUserId, caseId],
  );

  await deps.db.execute(
    `INSERT INTO risk.fraud_reviews (case_id, admin_user_id, decision, notes, ban_buyer)
     VALUES ($1, $2, 'escalate', $3, FALSE)`,
    [caseId, csUserId, reason],
  );

  await deps.db.execute(
    `INSERT INTO risk.fraud_case_audit (case_id, actor_id, from_status, to_status, note)
     VALUES ($1, $2, $3, 'escalated', $4)`,
    [caseId, csUserId, row.status, reason],
  );

  deps.eventBus
    .send('fraud.case.escalated', {
      caseId,
      orderId: row.order_id,
      csUserId,
      reason,
      previousPriority: row.priority,
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// 8. Overdue / SLA widget
// ---------------------------------------------------------------------------

export interface OverdueCase {
  id: string;
  orderId: string;
  priority: string;
  riskScore: number;
  slaDeadlineAt: string;
  overdueMinutes: number;
}

export async function getOverdueCases(deps: FraudDeps): Promise<OverdueCase[]> {
  const rows = await deps.db.query<{
    id: string; order_id: string; priority: string; risk_score: number;
    sla_deadline_at: string; overdue_minutes: string;
  }>(
    `SELECT id, order_id, priority, risk_score, sla_deadline_at,
            EXTRACT(EPOCH FROM (NOW() - sla_deadline_at)) / 60 AS overdue_minutes
     FROM risk.fraud_cases
     WHERE status IN ('pending_review', 'reviewing')
       AND sla_deadline_at IS NOT NULL
       AND sla_deadline_at < NOW()
     ORDER BY sla_deadline_at ASC`,
  );

  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    priority: r.priority,
    riskScore: r.risk_score,
    slaDeadlineAt: r.sla_deadline_at,
    overdueMinutes: Math.floor(parseFloat(r.overdue_minutes)),
  }));
}

// ---------------------------------------------------------------------------
// 9. Audit trail query
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  caseId: string;
  actorId: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

export async function getCaseAudit(caseId: string, deps: FraudDeps): Promise<AuditEntry[]> {
  const rows = await deps.db.query<{
    id: string; case_id: string; actor_id: string;
    from_status: string | null; to_status: string; note: string | null; created_at: string;
  }>(
    `SELECT id, case_id, actor_id, from_status, to_status, note, created_at
     FROM risk.fraud_case_audit
     WHERE case_id = $1
     ORDER BY created_at ASC`,
    [caseId],
  );
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    actorId: r.actor_id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    note: r.note,
    createdAt: r.created_at,
  }));
}

function mapToSummary(row: {
  id: string; order_id: string; user_id: string; promoter_id: string | null;
  amount_hellers: number; currency: string; risk_score: number;
  signals: unknown; status: string; priority: string; order_held: boolean;
  country_code: string | null; created_at: string;
}): FraudCaseSummary {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    promoterId: row.promoter_id,
    amountHellers: row.amount_hellers,
    currency: row.currency,
    riskScore: row.risk_score,
    signals: (typeof row.signals === 'string' ? JSON.parse(row.signals) : row.signals) as FraudSignal[],
    status: row.status,
    priority: row.priority,
    orderHeld: row.order_held,
    countryCode: row.country_code,
    createdAt: row.created_at,
  };
}
