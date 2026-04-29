export interface PlatformOverview {
  // Promotéři
  totalPromoters: number;
  activePromoters: number;
  pendingKyc: number;
  suspendedPromoters: number;
  // Objednávky a revenue (posledních 30 dní)
  gmv30d: number;              // haléře — Gross Merchandise Value
  platformRevenue30d: number;  // haléře — platform fees
  ordersCount30d: number;
  // Payouty
  pendingPayoutsCount: number;
  pendingPayoutsAmount: number; // haléře
  // Notifikace
  unreadNotifications: number;
  criticalNotifications: number;
}

export interface PromoterListItem {
  id: string;
  name: string;
  email: string;
  ico: string | null;
  status: string;
  kycStatus: string;
  slug: string | null;
  createdAt: string;
  // Agregované stats
  totalEvents: number;
  totalRevenue: number;     // haléře — lifetime
  activeEvents: number;
  lastActivityAt: string | null;
}

export interface PayoutSummaryItem {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface EventSummaryItem {
  id: string;
  title: string;
  status: string;
  startsAt: string | null;
  totalRevenue: number;
}

export interface AdminActionItem {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface PromoterDetail extends PromoterListItem {
  legalName: string | null;
  dic: string | null;
  phone: string | null;
  website: string | null;
  bankAccountIban: string | null;
  kycVerifiedAt: string | null;
  kycNotes: string | null;
  // Historie
  recentPayouts: PayoutSummaryItem[];
  recentEvents: EventSummaryItem[];
  adminActions: AdminActionItem[];
}

export interface AdminNotification {
  id: string;
  type: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  title: string;
  body: string | null;
  targetType: string | null;
  targetId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface DailyStats {
  date: string;           // YYYY-MM-DD
  gmv: number;            // haléře
  platformRevenue: number;
  ordersCount: number;
  newPromoters: number;
  activePromoters: number;
}

export interface PromoterFilters {
  status?: string;
  kycStatus?: string;
  search?: string;       // name, email, IČO
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'name' | 'total_revenue' | 'last_activity';
  sortOrder?: 'asc' | 'desc';
}

export interface KycQueueItem {
  id: string;
  name: string;
  email: string;
  ico: string | null;
  kycStatus: string;
  waitingDays: number;
  submittedAt: string | null;
  createdAt: string;
}

export interface KycStats {
  totalPending: number;
  avgWaitingDays: number;
  approvedToday: number;
  rejectedToday: number;
}

export interface BulkActionResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}
