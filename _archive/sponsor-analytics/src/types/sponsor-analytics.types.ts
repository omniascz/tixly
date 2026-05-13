export type SponsorshipTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type DataPackageType = 'demographic' | 'geographic' | 'purchase_patterns' | 'engagement' | 'full_suite';
export type ReportStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface SponsorContract {
  id: string;
  organizerId: string;
  sponsorName: string;
  sponsorEmail: string;
  eventId: string | null;        // null = platform-wide sponsorship
  tier: SponsorshipTier;
  dataPackages: DataPackageType[];
  contractStart: Date;
  contractEnd: Date;
  priceCzk: number;
  isActive: boolean;
  createdAt: Date;
}

export interface SponsorReport {
  id: string;
  contractId: string;
  eventId: string | null;
  reportType: DataPackageType;
  status: ReportStatus;
  generatedAt: Date | null;
  data: SponsorReportData | null;
}

export interface SponsorReportData {
  // Demographic
  ageGroups?: Record<string, number>;       // {'18-24': 450, '25-34': 1200, ...}
  genderSplit?: Record<string, number>;
  // Geographic
  cityBreakdown?: Record<string, number>;
  regionBreakdown?: Record<string, number>;
  // Purchase patterns
  averageOrderValueCzk?: number;
  repeatPurchaseRate?: number;
  ticketCategories?: Record<string, number>;
  // Engagement
  emailOpenRate?: number;
  appSessionsPerUser?: number;
  checkInRate?: number;
  // Meta
  totalAttendees?: number;
  dataAsOf?: string;                         // ISO date
}

export interface ContractInput {
  organizerId: string;
  sponsorName: string;
  sponsorEmail: string;
  eventId?: string;
  tier: SponsorshipTier;
  dataPackages: DataPackageType[];
  contractStart: Date;
  contractEnd: Date;
  priceCzk: number;
}

export interface SponsorDashboard {
  contractId: string;
  sponsorName: string;
  tier: SponsorshipTier;
  totalAttendees: number;
  recentReports: SponsorReport[];
  dataPackagesAvailable: DataPackageType[];
  contractDaysRemaining: number;
}

export class SponsorAnalyticsError extends Error {
  constructor(
    public readonly code: 'CONTRACT_NOT_FOUND' | 'REPORT_NOT_FOUND' | 'PACKAGE_NOT_INCLUDED' | 'CONTRACT_EXPIRED' | 'REPORT_NOT_READY',
    message: string
  ) { super(message); this.name = 'SponsorAnalyticsError'; }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface DataWarehouseAdapter {
  /** Načte demografická data pro event/platform */
  getDemographics(eventId: string | null): Promise<SponsorReportData>;
  getGeographic(eventId: string | null): Promise<SponsorReportData>;
  getPurchasePatterns(eventId: string | null): Promise<SponsorReportData>;
  getEngagement(eventId: string | null): Promise<SponsorReportData>;
}

export interface ServiceDeps {
  db: DbAdapter;
  dataWarehouse: DataWarehouseAdapter;
  now?: () => Date;
}
