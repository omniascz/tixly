import { ServiceDeps } from '../lib/service-container';
import { AdminError } from '../lib/admin-errors';
import type {
  PlatformOverview,
  PromoterListItem,
  PromoterDetail,
  PromoterFilters,
  DailyStats,
  KycQueueItem,
  KycStats,
  AdminNotification,
  AdminActionItem,
  BulkActionResult,
  PayoutSummaryItem,
  EventSummaryItem,
} from '../types/admin';

// ---------------------------------------------------------------------------
// Internal DB row types
// ---------------------------------------------------------------------------

interface PromoterStatusRow {
  status: string;
  cnt: string;
}

interface OrderStatsRow {
  gmv: string | null;
  platform_revenue: string | null;
  orders_count: string | null;
}

interface PayoutStatsRow {
  payout_count: string | null;
  payout_amount: string | null;
}

interface NotifCountRow {
  unread: string | null;
  critical: string | null;
}

interface DailyStatsRow {
  date: string;
  gmv: string | null;
  platform_revenue: string | null;
  orders_count: string | null;
  new_promoters: string | null;
  active_promoters: string | null;
}

interface PromoterRow {
  id: string;
  name: string;
  email: string;
  ico: string | null;
  status: string;
  kyc_status: string;
  slug: string | null;
  created_at: string;
  total_events: string | null;
  total_revenue: string | null;
  active_events: string | null;
  last_activity_at: string | null;
  total_count?: string | null;
}

interface PromoterDetailRow extends PromoterRow {
  legal_name: string | null;
  dic: string | null;
  phone: string | null;
  website: string | null;
  bank_account_iban: string | null;
  kyc_verified_at: string | null;
  kyc_notes: string | null;
}

interface PayoutRow {
  id: string;
  net_payout: string | null;
  status: string;
  created_at: string;
}

interface EventRow {
  id: string;
  title: string;
  status: string;
  starts_at: string | null;
  total_revenue: string | null;
}

interface AdminActionRow {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown> | string;
  ip_address: string | null;
  created_at: string;
}

interface KycQueueRow {
  id: string;
  name: string;
  email: string;
  ico: string | null;
  kyc_status: string;
  waiting_days: string | null;
  submitted_at: string | null;
  created_at: string;
  total_count?: string | null;
}

interface KycStatsRow {
  total_pending: string | null;
  avg_waiting_days: string | null;
  approved_today: string | null;
  rejected_today: string | null;
}

interface NotificationRow {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  target_type: string | null;
  target_id: string | null;
  is_read: boolean;
  created_at: string;
}

interface AuditLogRow extends AdminActionRow {
  total_count?: string | null;
}

interface CountRow {
  count: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntSafe(val: string | null | undefined, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

function parseFloatSafe(val: string | null | undefined, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function mapActionRow(row: AdminActionRow): AdminActionItem {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    details:
      typeof row.details === 'string' ? JSON.parse(row.details) : (row.details ?? {}),
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

function mapNotificationRow(row: NotificationRow): AdminNotification {
  return {
    id: row.id,
    type: row.type,
    priority: row.priority as AdminNotification['priority'],
    title: row.title,
    body: row.body,
    targetType: row.target_type,
    targetId: row.target_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

function mapPromoterRow(row: PromoterRow): PromoterListItem {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    ico: row.ico,
    status: row.status,
    kycStatus: row.kyc_status,
    slug: row.slug,
    createdAt: row.created_at,
    totalEvents: parseIntSafe(row.total_events),
    totalRevenue: parseIntSafe(row.total_revenue),
    activeEvents: parseIntSafe(row.active_events),
    lastActivityAt: row.last_activity_at,
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getPlatformOverview(deps: ServiceDeps): Promise<PlatformOverview> {
  const cached = await deps.redis.get('admin:overview');
  if (cached !== null) {
    return JSON.parse(cached) as PlatformOverview;
  }

  const [
    statusRows,
    kycRows,
    orderRows,
    payoutRows,
    notifRows,
  ] = await Promise.all([
    deps.db.query<PromoterStatusRow>(
      `SELECT status, COUNT(*)::TEXT AS cnt FROM platform.promoters GROUP BY status`,
    ),
    deps.db.query<{ cnt: string }>(
      `SELECT COUNT(*)::TEXT AS cnt FROM platform.promoters WHERE kyc_status = 'submitted'`,
    ),
    deps.db.query<OrderStatsRow>(
      `SELECT
         COALESCE(SUM(total_amount), 0)::TEXT AS gmv,
         COALESCE(SUM(platform_fee_amount), 0)::TEXT AS platform_revenue,
         COUNT(*)::TEXT AS orders_count
       FROM orders.orders
       WHERE created_at > NOW() - INTERVAL '30 days'
         AND status = 'paid'`,
    ),
    deps.db.query<PayoutStatsRow>(
      `SELECT
         COUNT(*)::TEXT AS payout_count,
         COALESCE(SUM(net_payout), 0)::TEXT AS payout_amount
       FROM platform.payouts
       WHERE status = 'pending'`,
    ),
    deps.db.query<NotifCountRow>(
      `SELECT
         COUNT(*)::TEXT AS unread,
         SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END)::TEXT AS critical
       FROM platform.admin_notifications
       WHERE is_read = FALSE`,
    ),
  ]);

  const statusMap = new Map(statusRows.map((r) => [r.status, parseIntSafe(r.cnt)]));

  const overview: PlatformOverview = {
    totalPromoters: [...statusMap.values()].reduce((a, b) => a + b, 0),
    activePromoters: statusMap.get('active') ?? 0,
    suspendedPromoters: statusMap.get('suspended') ?? 0,
    pendingKyc: parseIntSafe(kycRows[0]?.cnt),
    gmv30d: parseIntSafe(orderRows[0]?.gmv),
    platformRevenue30d: parseIntSafe(orderRows[0]?.platform_revenue),
    ordersCount30d: parseIntSafe(orderRows[0]?.orders_count),
    pendingPayoutsCount: parseIntSafe(payoutRows[0]?.payout_count),
    pendingPayoutsAmount: parseIntSafe(payoutRows[0]?.payout_amount),
    unreadNotifications: parseIntSafe(notifRows[0]?.unread),
    criticalNotifications: parseIntSafe(notifRows[0]?.critical),
  };

  const serialized = JSON.stringify(overview);
  await deps.redis.setex('admin:overview', 300, serialized);

  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  await deps.db.execute(
    `INSERT INTO platform.stats_cache (id, data, computed_at, expires_at)
     VALUES ('platform_overview', $1::jsonb, NOW(), $2)
     ON CONFLICT (id) DO UPDATE
       SET data = EXCLUDED.data,
           computed_at = EXCLUDED.computed_at,
           expires_at = EXCLUDED.expires_at`,
    [serialized, expiresAt],
  );

  return overview;
}

export async function getDailyStats(days: number, deps: ServiceDeps): Promise<DailyStats[]> {
  const cacheKey = `admin:daily_stats:${days}`;
  const cached = await deps.redis.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached) as DailyStats[];
  }

  const rows = await deps.db.query<DailyStatsRow>(
    `SELECT
       DATE(o.created_at)::TEXT AS date,
       COALESCE(SUM(o.total_amount), 0)::TEXT AS gmv,
       COALESCE(SUM(o.platform_fee_amount), 0)::TEXT AS platform_revenue,
       COUNT(o.id)::TEXT AS orders_count,
       COALESCE(np.new_promoters, 0)::TEXT AS new_promoters,
       COALESCE(ap.active_promoters, 0)::TEXT AS active_promoters
     FROM orders.orders o
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::BIGINT AS new_promoters
       FROM platform.promoters p
       WHERE DATE(p.created_at) = DATE(o.created_at)
     ) np ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT promoter_id)::BIGINT AS active_promoters
       FROM catalog.events e2
       WHERE DATE(e2.updated_at) = DATE(o.created_at)
         AND e2.status = 'published'
     ) ap ON TRUE
     WHERE o.created_at > NOW() - ($1 || ' days')::INTERVAL
       AND o.status = 'paid'
     GROUP BY DATE(o.created_at), np.new_promoters, ap.active_promoters
     ORDER BY date DESC
     LIMIT $1`,
    [days],
  );

  const result: DailyStats[] = rows.map((r) => ({
    date: r.date,
    gmv: parseIntSafe(r.gmv),
    platformRevenue: parseIntSafe(r.platform_revenue),
    ordersCount: parseIntSafe(r.orders_count),
    newPromoters: parseIntSafe(r.new_promoters),
    activePromoters: parseIntSafe(r.active_promoters),
  }));

  await deps.redis.setex(cacheKey, 600, JSON.stringify(result));
  return result;
}

// ---------------------------------------------------------------------------
// Promoter management
// ---------------------------------------------------------------------------

export async function listPromoters(
  filters: PromoterFilters,
  deps: ServiceDeps,
): Promise<{ items: PromoterListItem[]; total: number }> {
  const {
    status,
    kycStatus,
    search,
    createdFrom,
    createdTo,
    limit = 20,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = filters;

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (kycStatus) {
    params.push(kycStatus);
    conditions.push(`p.kyc_status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(
      `(p.name ILIKE $${idx} OR p.email ILIKE $${idx} OR p.ico ILIKE $${idx})`,
    );
  }
  if (createdFrom) {
    params.push(createdFrom);
    conditions.push(`p.created_at >= $${params.length}`);
  }
  if (createdTo) {
    params.push(createdTo);
    conditions.push(`p.created_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const columnMap: Record<NonNullable<PromoterFilters['sortBy']>, string> = {
    created_at: 'p.created_at',
    name: 'p.name',
    total_revenue: 'total_revenue',
    last_activity: 'last_activity_at',
  };
  const orderCol = columnMap[sortBy ?? 'created_at'];
  const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const sql = `
    SELECT
      p.id,
      p.name,
      p.email,
      p.ico,
      p.status,
      p.kyc_status,
      p.slug,
      p.created_at::TEXT,
      COUNT(DISTINCT e.id)::TEXT AS total_events,
      COALESCE(SUM(o.total_amount), 0)::TEXT AS total_revenue,
      COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'published')::TEXT AS active_events,
      MAX(o.created_at)::TEXT AS last_activity_at,
      COUNT(*) OVER()::TEXT AS total_count
    FROM platform.promoters p
    LEFT JOIN catalog.events e ON e.promoter_id = p.id
    LEFT JOIN orders.orders o ON o.promoter_id = p.id AND o.status = 'paid'
    ${where}
    GROUP BY p.id, p.name, p.email, p.ico, p.status, p.kyc_status, p.slug, p.created_at
    ORDER BY ${orderCol} ${orderDir} NULLS LAST
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const rows = await deps.db.query<PromoterRow>(sql, params);

  const total = rows.length > 0 ? parseIntSafe(rows[0].total_count) : 0;
  const items = rows.map(mapPromoterRow);

  return { items, total };
}

export async function getPromoterDetail(
  promoterId: string,
  deps: ServiceDeps,
): Promise<PromoterDetail> {
  const [promoterRows, payoutRows, eventRows, actionRows] = await Promise.all([
    deps.db.query<PromoterDetailRow>(
      `SELECT
         p.id, p.name, p.email, p.ico, p.status, p.kyc_status, p.slug,
         p.created_at::TEXT,
         p.legal_name, p.dic, p.phone, p.website, p.bank_account_iban,
         p.kyc_verified_at::TEXT, p.kyc_notes,
         COUNT(DISTINCT e.id)::TEXT AS total_events,
         COALESCE(SUM(o.total_amount), 0)::TEXT AS total_revenue,
         COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'published')::TEXT AS active_events,
         MAX(o.created_at)::TEXT AS last_activity_at
       FROM platform.promoters p
       LEFT JOIN catalog.events e ON e.promoter_id = p.id
       LEFT JOIN orders.orders o ON o.promoter_id = p.id AND o.status = 'paid'
       WHERE p.id = $1
       GROUP BY p.id`,
      [promoterId],
    ),
    deps.db.query<PayoutRow>(
      `SELECT id, net_payout::TEXT, status, created_at::TEXT
       FROM platform.payouts
       WHERE promoter_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [promoterId],
    ),
    deps.db.query<EventRow>(
      `SELECT
         e.id, e.title, e.status, e.starts_at::TEXT,
         COALESCE(SUM(o.total_amount), 0)::TEXT AS total_revenue
       FROM catalog.events e
       LEFT JOIN orders.orders o ON o.event_id = e.id AND o.status = 'paid'
       WHERE e.promoter_id = $1
       GROUP BY e.id
       ORDER BY e.created_at DESC
       LIMIT 5`,
      [promoterId],
    ),
    deps.db.query<AdminActionRow>(
      `SELECT id, admin_user_id, action, target_type, target_id,
              details, ip_address, created_at::TEXT
       FROM platform.admin_actions
       WHERE target_type = 'promoter' AND target_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [promoterId],
    ),
  ]);

  if (promoterRows.length === 0) {
    throw new AdminError('PROMOTER_NOT_FOUND', `Promoter ${promoterId} not found`);
  }

  const p = promoterRows[0];

  const recentPayouts: PayoutSummaryItem[] = payoutRows.map((r) => ({
    id: r.id,
    amount: parseIntSafe(r.net_payout),
    status: r.status,
    createdAt: r.created_at,
  }));

  const recentEvents: EventSummaryItem[] = eventRows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    startsAt: r.starts_at,
    totalRevenue: parseIntSafe(r.total_revenue),
  }));

  return {
    id: p.id,
    name: p.name,
    email: p.email,
    ico: p.ico,
    status: p.status,
    kycStatus: p.kyc_status,
    slug: p.slug,
    createdAt: p.created_at,
    totalEvents: parseIntSafe(p.total_events),
    totalRevenue: parseIntSafe(p.total_revenue),
    activeEvents: parseIntSafe(p.active_events),
    lastActivityAt: p.last_activity_at,
    legalName: p.legal_name,
    dic: p.dic,
    phone: p.phone,
    website: p.website,
    bankAccountIban: p.bank_account_iban,
    kycVerifiedAt: p.kyc_verified_at,
    kycNotes: p.kyc_notes,
    recentPayouts,
    recentEvents,
    adminActions: actionRows.map(mapActionRow),
  };
}

export async function bulkUpdatePromoterStatus(
  promoterIds: string[],
  action: 'suspend' | 'activate' | 'ban',
  reason: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<BulkActionResult> {
  if (promoterIds.length > 50) {
    throw new AdminError(
      'INVALID_ACTION',
      'Bulk operations are limited to 50 promoters at a time',
    );
  }

  const statusMap: Record<'suspend' | 'activate' | 'ban', string> = {
    suspend: 'suspended',
    activate: 'active',
    ban: 'banned',
  };
  const newStatus = statusMap[action];

  const succeeded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  await Promise.all(
    promoterIds.map(async (id) => {
      try {
        await deps.db.execute(
          `UPDATE platform.promoters SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, id],
        );
        logAdminAction(adminUserId, action, 'promoter', id, { reason, newStatus }, deps).catch(
          () => {},
        );
        succeeded.push(id);
      } catch (err) {
        failed.push({
          id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }),
  );

  invalidateOverviewCache(deps).catch(() => {});

  return { succeeded, failed };
}

// ---------------------------------------------------------------------------
// KYC queue
// ---------------------------------------------------------------------------

export async function getKycQueue(
  filters: { priority?: 'all' | 'waiting_long'; limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: KycQueueItem[]; total: number }> {
  const { priority = 'all', limit = 20, offset = 0 } = filters;

  const params: unknown[] = [];
  const conditions: string[] = [`p.kyc_status = 'submitted'`];

  if (priority === 'waiting_long') {
    conditions.push(
      `EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 > 2`,
    );
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  params.push(limit, offset);

  const rows = await deps.db.query<KycQueueRow>(
    `SELECT
       p.id,
       p.name,
       p.email,
       p.ico,
       p.kyc_status,
       ROUND(EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400)::TEXT AS waiting_days,
       p.updated_at::TEXT AS submitted_at,
       p.created_at::TEXT,
       COUNT(*) OVER()::TEXT AS total_count
     FROM platform.promoters p
     ${where}
     ORDER BY p.created_at ASC
     LIMIT $1 OFFSET $2`,
    params,
  );

  const total = rows.length > 0 ? parseIntSafe(rows[0].total_count) : 0;

  const items: KycQueueItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    ico: r.ico,
    kycStatus: r.kyc_status,
    waitingDays: parseIntSafe(r.waiting_days),
    submittedAt: r.submitted_at,
    createdAt: r.created_at,
  }));

  return { items, total };
}

export async function getKycStats(deps: ServiceDeps): Promise<KycStats> {
  const rows = await deps.db.query<KycStatsRow>(
    `SELECT
       COUNT(*) FILTER (WHERE kyc_status = 'submitted')::TEXT AS total_pending,
       ROUND(
         AVG(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400)
         FILTER (WHERE kyc_status = 'submitted')
       )::TEXT AS avg_waiting_days,
       COUNT(*) FILTER (
         WHERE kyc_status = 'approved' AND DATE(updated_at) = CURRENT_DATE
       )::TEXT AS approved_today,
       COUNT(*) FILTER (
         WHERE kyc_status = 'rejected' AND DATE(updated_at) = CURRENT_DATE
       )::TEXT AS rejected_today
     FROM platform.promoters`,
  );

  const r = rows[0];
  return {
    totalPending: parseIntSafe(r?.total_pending),
    avgWaitingDays: parseFloatSafe(r?.avg_waiting_days),
    approvedToday: parseIntSafe(r?.approved_today),
    rejectedToday: parseIntSafe(r?.rejected_today),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function listNotifications(
  filters: { isRead?: boolean; priority?: string; limit?: number },
  deps: ServiceDeps,
): Promise<AdminNotification[]> {
  const { isRead, priority, limit = 50 } = filters;

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (isRead !== undefined) {
    params.push(isRead);
    conditions.push(`is_read = $${params.length}`);
  }
  if (priority) {
    params.push(priority);
    conditions.push(`priority = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);

  const rows = await deps.db.query<NotificationRow>(
    `SELECT id, type, priority, title, body, target_type, target_id, is_read, created_at::TEXT
     FROM platform.admin_notifications
     ${where}
     ORDER BY is_read ASC, priority DESC, created_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map(mapNotificationRow);
}

export async function markNotificationRead(
  notificationId: string,
  adminUserId: string,
  deps: ServiceDeps,
): Promise<void> {
  const existing = await deps.db.query<{ id: string }>(
    `SELECT id FROM platform.admin_notifications WHERE id = $1`,
    [notificationId],
  );
  if (existing.length === 0) {
    throw new AdminError(
      'NOTIFICATION_NOT_FOUND',
      `Notification ${notificationId} not found`,
    );
  }

  await deps.db.execute(
    `UPDATE platform.admin_notifications
     SET is_read = TRUE, read_by = $1, read_at = NOW()
     WHERE id = $2`,
    [adminUserId, notificationId],
  );
}

export async function markAllNotificationsRead(
  adminUserId: string,
  deps: ServiceDeps,
): Promise<{ count: number }> {
  const rows = await deps.db.query<CountRow>(
    `WITH updated AS (
       UPDATE platform.admin_notifications
       SET is_read = TRUE, read_by = $1, read_at = NOW()
       WHERE is_read = FALSE
       RETURNING id
     )
     SELECT COUNT(*)::TEXT AS count FROM updated`,
    [adminUserId],
  );

  return { count: parseIntSafe(rows[0]?.count) };
}

export async function createNotification(
  input: {
    type: string;
    priority: string;
    title: string;
    body?: string;
    targetType?: string;
    targetId?: string;
  },
  deps: ServiceDeps,
): Promise<AdminNotification> {
  const rows = await deps.db.query<NotificationRow>(
    `INSERT INTO platform.admin_notifications
       (type, priority, title, body, target_type, target_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, type, priority, title, body, target_type, target_id, is_read, created_at::TEXT`,
    [
      input.type,
      input.priority,
      input.title,
      input.body ?? null,
      input.targetType ?? null,
      input.targetId ?? null,
    ],
  );

  return mapNotificationRow(rows[0]);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function getAuditLog(
  filters: {
    adminUserId?: string;
    targetType?: string;
    targetId?: string;
    action?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
  deps: ServiceDeps,
): Promise<{ items: AdminActionItem[]; total: number }> {
  const { adminUserId, targetType, targetId, action, from, to, limit = 50, offset = 0 } =
    filters;

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (adminUserId) {
    params.push(adminUserId);
    conditions.push(`admin_user_id = $${params.length}`);
  }
  if (targetType) {
    params.push(targetType);
    conditions.push(`target_type = $${params.length}`);
  }
  if (targetId) {
    params.push(targetId);
    conditions.push(`target_id = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit, offset);

  const rows = await deps.db.query<AuditLogRow>(
    `SELECT
       id, admin_user_id, action, target_type, target_id,
       details, ip_address, created_at::TEXT,
       COUNT(*) OVER()::TEXT AS total_count
     FROM platform.admin_actions
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const total = rows.length > 0 ? parseIntSafe(rows[0].total_count) : 0;
  return { items: rows.map(mapActionRow), total };
}

export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
  deps: ServiceDeps,
): Promise<void> {
  await deps.db.execute(
    `INSERT INTO platform.admin_actions
       (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [adminUserId, action, targetType, targetId, JSON.stringify(details)],
  );
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

export async function invalidateOverviewCache(deps: ServiceDeps): Promise<void> {
  await Promise.all([
    deps.redis.del('admin:overview'),
    deps.redis.del('admin:daily_stats'),
  ]);
}
