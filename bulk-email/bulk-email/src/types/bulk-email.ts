export type BulkCampaignStatus =
  | 'draft'
  | 'queued'
  | 'sending'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface SegmentFilter {
  /** e.g. 'all', 'active', 'dormant_30', 'has_active_package', 'no_active_package', 'tag' */
  type: string;
  /** Free-form params per type */
  params?: Record<string, unknown>;
  /** Required tags (intersection) */
  tags?: string[];
}

export interface BulkCampaign {
  id: string;
  promoterId: string;
  name: string;
  subject: string;
  htmlBody: string;
  segment: SegmentFilter;
  status: BulkCampaignStatus;
  totalRecipients: number;
  sent: number;
  failed: number;
  skipped: number;
  createdBy: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CampaignRecipient {
  id: string;
  campaignId: string;
  email: string;
  firstName: string;
  status: RecipientStatus;
  sentAt: Date | null;
  errorMessage: string | null;
}

export interface CreateCampaignInput {
  promoterId: string;
  name: string;
  subject: string;
  htmlBody: string;
  segment: SegmentFilter;
}
