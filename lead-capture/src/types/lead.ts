export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost';
export type LeadPriority = 'low' | 'medium' | 'high';

export interface Lead {
  id: string;
  promoterId: string;
  /** Source page slug e.g. "ems-zada-pater" */
  sourcePage: string | null;
  /** Source channel: 'web', 'fb', 'google_ads', etc. */
  source: string | null;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  /** Free-form: which package/service interested in */
  interest: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  /** Tags for filtering */
  tags: string[];
  /** Admin notes (separate from message which is the user's input) */
  notes: string | null;
  assignedToUserId: string | null;
  /** UTM params from URL */
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** GDPR consent timestamp */
  consentedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contactedAt: Date | null;
}

export interface CreateLeadInput {
  promoterId: string;
  sourcePage?: string;
  source?: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  message?: string;
  interest?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** GDPR consent — required */
  consented: boolean;
}

export interface UpdateLeadInput {
  status?: LeadStatus;
  priority?: LeadPriority;
  tags?: string[];
  notes?: string | null;
  assignedToUserId?: string | null;
  contactedAt?: Date | null;
}
