export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed' | 'bounced';

export interface NewsletterSubscriber {
  id: string;
  promoterId: string;
  email: string;
  firstName: string | null;
  status: SubscriberStatus;
  /** Tags for segmentation, e.g. ['ems-brno', 'leads-2026-q2'] */
  tags: string[];
  /** Source of signup */
  source: string | null;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
}

export interface SubscribeInput {
  promoterId: string;
  email: string;
  firstName?: string;
  source?: string;
  tags?: string[];
}
