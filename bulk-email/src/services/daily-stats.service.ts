// =============================================================================
// Daily Stats Email Service
// Feature #178: Automated morning digest of sales sent to promoters
//
// Cron triggers this daily. For each subscribed promoter:
//   - Queries yesterday's ticket sales and revenue
//   - Flags events with 0 sales (if configured)
//   - Sends formatted email via injectable EmailSender
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Injectable email sender */
export interface EmailSender {
  send(to: string, subject: string, htmlBody: string): Promise<void>;
}

export interface DailyStatsSubscription {
  id: string;
  promoterId: string;
  email: string;
  sendHourUtc: number;
  includeZeroSales: boolean;
  isActive: boolean;
}

export interface EventDailyStat {
  eventId: string;
  eventName: string;
  ticketsSold: number;
  revenueHellers: number;
}

export interface DailyStatsSummary {
  promoterId: string;
  periodDate: string;
  totalTicketsSold: number;
  totalRevenueHellers: number;
  eventStats: EventDailyStat[];
}

interface SubscriptionRow {
  id: string;
  promoter_id: string;
  email: string;
  send_hour_utc: number;
  include_zero_sales: boolean;
  is_active: boolean;
}

/**
 * Subscribe a promoter to daily stats emails.
 */
export async function subscribeDailyStats(
  input: {
    promoterId: string;
    email: string;
    sendHourUtc?: number;
    includeZeroSales?: boolean;
  },
  db: DbAdapter,
): Promise<DailyStatsSubscription> {
  if (!input.email.includes('@')) throw new Error('VALIDATION_ERROR: invalid email');

  const hour = input.sendHourUtc ?? 7;
  if (hour < 0 || hour > 23) throw new Error('VALIDATION_ERROR: sendHourUtc must be 0–23');

  const rows = await db.query<SubscriptionRow>(
    `INSERT INTO notifications.daily_stats_subscriptions
       (promoter_id, email, send_hour_utc, include_zero_sales)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (promoter_id) DO UPDATE SET
       email = EXCLUDED.email,
       send_hour_utc = EXCLUDED.send_hour_utc,
       include_zero_sales = EXCLUDED.include_zero_sales,
       is_active = true,
       updated_at = NOW()
     RETURNING *`,
    [input.promoterId, input.email, hour, input.includeZeroSales ?? true],
  );

  const r = rows[0];
  return {
    id: r.id,
    promoterId: r.promoter_id,
    email: r.email,
    sendHourUtc: r.send_hour_utc,
    includeZeroSales: r.include_zero_sales,
    isActive: r.is_active,
  };
}

/**
 * Unsubscribe a promoter from daily stats emails.
 */
export async function unsubscribeDailyStats(
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE notifications.daily_stats_subscriptions
     SET is_active = false, updated_at = NOW()
     WHERE promoter_id = $1`,
    [promoterId],
  );
}

/**
 * Gather daily stats for a promoter for the given date (YYYY-MM-DD).
 */
export async function gatherDailyStats(
  promoterId: string,
  periodDate: string,
  db: DbAdapter,
): Promise<DailyStatsSummary> {
  const eventRows = await db.query<{
    event_id: string;
    event_name: string;
    tickets_sold: string;
    revenue_hellers: string;
  }>(
    `SELECT
       e.id AS event_id,
       e.name AS event_name,
       COUNT(t.id) AS tickets_sold,
       COALESCE(SUM(t.price_hellers), 0) AS revenue_hellers
     FROM catalog.events e
     LEFT JOIN tickets.tickets t
       ON t.event_id = e.id
       AND DATE(t.created_at) = $2::date
       AND t.status NOT IN ('cancelled', 'refunded')
     WHERE e.promoter_id = $1
     GROUP BY e.id, e.name
     ORDER BY e.name ASC`,
    [promoterId, periodDate],
  );

  const eventStats: EventDailyStat[] = eventRows.map((r) => ({
    eventId: r.event_id,
    eventName: r.event_name,
    ticketsSold: Number(r.tickets_sold),
    revenueHellers: Number(r.revenue_hellers),
  }));

  const totalTicketsSold = eventStats.reduce((s, e) => s + e.ticketsSold, 0);
  const totalRevenueHellers = eventStats.reduce((s, e) => s + e.revenueHellers, 0);

  return { promoterId, periodDate, totalTicketsSold, totalRevenueHellers, eventStats };
}

/**
 * Format stats into HTML email body.
 */
export function formatStatsEmail(summary: DailyStatsSummary): { subject: string; htmlBody: string } {
  const dateLabel = summary.periodDate;
  const revenueCzk = (summary.totalRevenueHellers / 100).toFixed(2);

  const subject = `Denní přehled prodejů ${dateLabel}: ${summary.totalTicketsSold} vstupenek, ${revenueCzk} Kč`;

  const rows = summary.eventStats
    .map((e) => {
      const rev = (e.revenueHellers / 100).toFixed(2);
      const zeroAlert = e.ticketsSold === 0 ? ' ⚠️' : '';
      return `<tr><td>${e.eventName}${zeroAlert}</td><td>${e.ticketsSold}</td><td>${rev} Kč</td></tr>`;
    })
    .join('\n');

  const htmlBody = `
<html><body>
<h2>Denní přehled prodejů — ${dateLabel}</h2>
<p>Celkem prodáno: <strong>${summary.totalTicketsSold} vstupenek</strong> za <strong>${revenueCzk} Kč</strong></p>
<table border="1" cellpadding="6" cellspacing="0">
  <thead><tr><th>Akce</th><th>Prodáno</th><th>Tržba</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p style="color:#888;font-size:12px;">Odhlásit se z denního přehledu: nastavení → notifikace.</p>
</body></html>`.trim();

  return { subject, htmlBody };
}

/**
 * Send daily stats email for a promoter.
 * Called by cron for each active subscription.
 * Logs result to daily_stats_log.
 */
export async function sendDailyStats(
  promoterId: string,
  periodDate: string,
  emailSender: EmailSender,
  db: DbAdapter,
): Promise<void> {
  const subs = await db.query<SubscriptionRow>(
    `SELECT * FROM notifications.daily_stats_subscriptions
     WHERE promoter_id = $1 AND is_active = true`,
    [promoterId],
  );

  if (!subs[0]) return; // not subscribed

  const sub = subs[0];
  const summary = await gatherDailyStats(promoterId, periodDate, db);

  // Skip if no events and include_zero_sales is false
  const hasActivity = summary.totalTicketsSold > 0;
  if (!hasActivity && !sub.include_zero_sales) {
    await db.execute(
      `INSERT INTO notifications.daily_stats_log
         (promoter_id, period_date, events_count, tickets_sold, revenue_hellers, status)
       VALUES ($1, $2, $3, 0, 0, 'skipped')`,
      [promoterId, periodDate, summary.eventStats.length],
    );
    return;
  }

  try {
    const { subject, htmlBody } = formatStatsEmail(summary);
    await emailSender.send(sub.email, subject, htmlBody);

    await db.execute(
      `INSERT INTO notifications.daily_stats_log
         (promoter_id, period_date, events_count, tickets_sold, revenue_hellers, status)
       VALUES ($1, $2, $3, $4, $5, 'sent')`,
      [promoterId, periodDate, summary.eventStats.length, summary.totalTicketsSold, summary.totalRevenueHellers],
    );
  } catch (err) {
    await db.execute(
      `INSERT INTO notifications.daily_stats_log
         (promoter_id, period_date, events_count, tickets_sold, revenue_hellers, status, error_message)
       VALUES ($1, $2, $3, $4, $5, 'failed', $6)`,
      [
        promoterId, periodDate, summary.eventStats.length,
        summary.totalTicketsSold, summary.totalRevenueHellers,
        err instanceof Error ? err.message : 'UNKNOWN_ERROR',
      ],
    );
    throw err;
  }
}
