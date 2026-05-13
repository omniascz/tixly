// ---------------------------------------------------------------------------
// Attribution model
// ---------------------------------------------------------------------------

export type AttributionModel = 'first_click' | 'last_click' | 'linear';

// ---------------------------------------------------------------------------
// UTM parameters
// ---------------------------------------------------------------------------

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

// ---------------------------------------------------------------------------
// TouchPoint — a single interaction recorded before a conversion
// ---------------------------------------------------------------------------

export interface TouchPoint {
  id: string;
  sessionId: string;
  /** Null until the user authenticates */
  userId: string | null;
  /** Null for non-event-specific pages */
  eventId: string | null;
  utmParams: UtmParams | null;
  /** Derived from utm_source (or referrer) at tracking time */
  channel: string;
  referrer: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// AttributionResult — credit assigned to one touch point
// ---------------------------------------------------------------------------

export interface AttributionResult {
  touchPointId: string;
  channel: string;
  /** Value between 0 and 1; all results for one conversion sum to exactly 1 */
  credit: number;
}

// ---------------------------------------------------------------------------
// ChannelPerformance — aggregated stats for a single channel
// ---------------------------------------------------------------------------

export interface ChannelPerformance {
  channel: string;
  touchPoints: number;
  /** Total attributed revenue in haléře (CZK × 100) */
  attributedRevenue: number;
  attributedOrders: number;
  /** Average order value in haléře */
  avgOrderValue: number;
}

// ---------------------------------------------------------------------------
// ConversionAttribution — full attribution record for one order
// ---------------------------------------------------------------------------

export interface ConversionAttribution {
  id: string;
  orderId: string;
  /** Order amount in haléře */
  orderAmount: number;
  model: AttributionModel;
  touchPoints: AttributionResult[];
  createdAt: Date;
}
