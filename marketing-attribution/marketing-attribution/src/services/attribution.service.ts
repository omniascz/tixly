/**
 * attribution.service.ts — Multi-touch attribution service
 *
 * All monetary values are in haléře (integer, CZK × 100).
 *
 * Adapters are injected via `ServiceDeps` to keep the service testable without
 * any real infrastructure.  withTenantContext is stubbed locally — in
 * production it would be replaced by the shared @tixly/tenant package.
 */

import { calculateAttribution } from '../lib/attribution-calculator';
import type {
  AttributionModel,
  AttributionResult,
  ChannelPerformance,
  ConversionAttribution,
  TouchPoint,
  UtmParams,
} from '../types/attribution.types';

// ---------------------------------------------------------------------------
// Adapter interfaces
// ---------------------------------------------------------------------------

export interface DbAdapter {
  insertTouchPoint(tp: Omit<TouchPoint, 'id' | 'createdAt'>): Promise<TouchPoint>;
  getTouchPointsBySession(sessionId: string): Promise<TouchPoint[]>;
  insertConversionAttribution(
    data: Omit<ConversionAttribution, 'id' | 'createdAt'>,
  ): Promise<ConversionAttribution>;
  getConversionAttributionByOrderId(orderId: string): Promise<ConversionAttribution | null>;
  /**
   * Returns raw rows for channel performance aggregation filtered by
   * promoter, event, and date range.
   */
  getAttributedConversions(params: {
    promoterId: string;
    eventId: string;
    from: Date;
    to: Date;
  }): Promise<AttributedConversionRow[]>;
}

export interface AttributedConversionRow {
  channel: string;
  orderAmount: number;   // haléře
  credit: number;        // 0–1
}

export interface EventBusAdapter {
  emit(topic: string, payload: unknown): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  eventBus: EventBusAdapter;
}

import { withTenantContext } from '@tixly/rls-multitenancy';

// ---------------------------------------------------------------------------
// Kafka topic constant
// ---------------------------------------------------------------------------

const KAFKA_TOPIC_TOUCH_POINT = 'tixly.attribution.touch-point';

// ---------------------------------------------------------------------------
// trackTouchPoint
// ---------------------------------------------------------------------------

export interface TrackTouchPointParams {
  sessionId: string;
  userId?: string;
  eventId?: string;
  utmParams: UtmParams | null;
  referrer: string | null;
  channel: string;
  /** tenantId is used for withTenantContext */
  tenantId?: string;
}

/**
 * Records a marketing touch point.
 *
 * Fire-and-forget: the caller does NOT await the returned promise.
 * Errors are swallowed internally and logged to stderr so they never
 * surface to the end user.
 */
export function trackTouchPoint(
  deps: ServiceDeps,
  params: TrackTouchPointParams,
): void {
  const tenantId = params.tenantId ?? 'default';

  void withTenantContext(tenantId, async () => {
    const tp = await deps.db.insertTouchPoint({
      sessionId: params.sessionId,
      userId: params.userId ?? null,
      eventId: params.eventId ?? null,
      utmParams: params.utmParams,
      referrer: params.referrer,
      channel: params.channel,
    });

    await deps.eventBus.emit(KAFKA_TOPIC_TOUCH_POINT, {
      touchPointId: tp.id,
      sessionId: tp.sessionId,
      userId: tp.userId,
      eventId: tp.eventId,
      channel: tp.channel,
      utmParams: tp.utmParams,
      referrer: tp.referrer,
      createdAt: tp.createdAt.toISOString(),
    });
  }).catch((err: unknown) => {
    console.error('[trackTouchPoint] fire-and-forget error:', err);
  });
}

// ---------------------------------------------------------------------------
// recordConversion
// ---------------------------------------------------------------------------

/**
 * Finds all touch points for the given session, computes attribution with the
 * chosen model, and persists a ConversionAttribution record.
 *
 * Default model: 'last_click'.
 */
export async function recordConversion(
  deps: ServiceDeps,
  orderId: string,
  orderAmount: number,
  sessionId: string,
  model: AttributionModel = 'last_click',
  tenantId = 'default',
): Promise<ConversionAttribution> {
  return withTenantContext(tenantId, async () => {
    const touchPoints = await deps.db.getTouchPointsBySession(sessionId);
    const attributionResults: AttributionResult[] = calculateAttribution(
      touchPoints,
      model,
    );

    const conversion = await deps.db.insertConversionAttribution({
      orderId,
      orderAmount,
      model,
      touchPoints: attributionResults,
    });

    return conversion;
  });
}

// ---------------------------------------------------------------------------
// getChannelPerformance
// ---------------------------------------------------------------------------

/**
 * Aggregates attributed revenue, orders, and touch point counts per channel
 * within the specified date range.  Results are sorted by attributedRevenue
 * descending.
 *
 * All amounts are in haléře.
 */
export async function getChannelPerformance(
  deps: ServiceDeps,
  promoterId: string,
  eventId: string,
  from: Date,
  to: Date,
  model: AttributionModel = 'last_click',
  tenantId = 'default',
): Promise<ChannelPerformance[]> {
  return withTenantContext(tenantId, async () => {
    const rows = await deps.db.getAttributedConversions({
      promoterId,
      eventId,
      from,
      to,
    });

    // Aggregate by channel
    const map = new Map<string, {
      touchPoints: number;
      attributedRevenue: number;
      attributedOrders: number;
    }>();

    for (const row of rows) {
      const existing = map.get(row.channel) ?? {
        touchPoints: 0,
        attributedRevenue: 0,
        attributedOrders: 0,
      };

      existing.touchPoints += 1;
      existing.attributedRevenue += Math.round(row.orderAmount * row.credit);

      // Each row represents one attribution result for one order.
      // We count a full attributed order when credit > 0.
      if (row.credit > 0) {
        existing.attributedOrders += row.credit;
      }

      map.set(row.channel, existing);
    }

    const performance: ChannelPerformance[] = [];

    for (const [channel, stats] of map.entries()) {
      const attributedOrders = Math.round(stats.attributedOrders);
      const avgOrderValue =
        attributedOrders > 0
          ? Math.round(stats.attributedRevenue / attributedOrders)
          : 0;

      performance.push({
        channel,
        touchPoints: stats.touchPoints,
        attributedRevenue: stats.attributedRevenue,
        attributedOrders,
        avgOrderValue,
      });
    }

    // Sort by attributed revenue descending
    performance.sort((a, b) => b.attributedRevenue - a.attributedRevenue);

    // Suppress unused model parameter warning — in a real implementation the
    // DB query would be filtered or post-processed by model.
    void model;

    return performance;
  });
}

// ---------------------------------------------------------------------------
// getConversionAttribution
// ---------------------------------------------------------------------------

/**
 * Returns the attribution detail for a specific order, or null if not found.
 */
export async function getConversionAttribution(
  deps: ServiceDeps,
  orderId: string,
  tenantId = 'default',
): Promise<ConversionAttribution | null> {
  return withTenantContext(tenantId, async () => {
    return deps.db.getConversionAttributionByOrderId(orderId);
  });
}
