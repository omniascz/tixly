// =============================================================================
// SMS marketing campaign types and interfaces
//
// Campaign builder with segmentation and scheduling for promotional and
// informational SMS messages.
// =============================================================================

/**
 * Campaign type: informational (confirmations, alerts) vs promotional (offers, discounts)
 */
export type CampaignType = 'informational' | 'promotional';

/**
 * Campaign status progression: pending -> scheduled -> sent -> archived
 */
export type CampaignStatus = 'pending' | 'scheduled' | 'sent' | 'archived';

/**
 * Segment rule operator for conditional logic
 */
export type SegmentOperator = 'equals' | 'in' | 'gte' | 'lte' | 'between';

/**
 * Segment rule type — determines which user attribute to match
 */
export type SegmentRuleType =
  | 'event_type'           // concert, festival, cinema, comedy (from order history)
  | 'geography'            // city/region from address
  | 'age'                  // age range (18-25, 26-40, 40+)
  | 'purchase_history'     // high_spender, repeat, one_time, inactive
  | 'engagement_level';    // opened_email, attended_event, referred_friend

/**
 * A segmentation rule for filtering campaign recipients
 */
export interface SegmentRule {
  type: SegmentRuleType;
  operator: SegmentOperator;
  values: string[] | number[];
}

/**
 * Campaign entity with all metadata and statistics
 */
export interface Campaign {
  id: string;
  promoterId: string;
  name: string;
  type: CampaignType;
  body: string;                   // SMS message content (max 160 chars)
  segmentRules: SegmentRule[];
  scheduledAt: string | null;     // ISO 8601 timestamp
  sentAt: string | null;          // When actually sent, ISO 8601
  status: CampaignStatus;
  stats: CampaignStatistic;
  createdAt: string;
  updatedAt: string;
}

/**
 * Campaign statistics — metrics for performance analysis
 */
export interface CampaignStatistic {
  campaignId: string;
  sentCount: number;
  failedCount: number;
  bouncedCount: number;
  clickCount: number;
  unsubscribeCount: number;
}

/**
 * Request/response for campaign creation
 */
export interface CreateCampaignInput {
  name: string;
  type: CampaignType;
  body: string;
  segmentRules: SegmentRule[];
}

/**
 * Request/response for publishing/scheduling campaign
 */
export interface PublishCampaignInput {
  scheduledAt: string;  // ISO 8601 timestamp
}

/**
 * Preview response showing segment size and sample recipients
 */
export interface CampaignPreview {
  segmentSize: number;
  exampleRecipients: Array<{
    userId: string;
    phone: string;
    eventType?: string;
    lastPurchaseDate?: string;
  }>;
}

/**
 * Performance/analytics response
 */
export interface CampaignPerformance {
  campaign: Campaign;
  successRate: number;           // (sentCount / (sentCount + failedCount)) * 100
  bounceRate: number;
  engagementRate: number;        // (clickCount + unsubscribeCount) / sentCount * 100
}
