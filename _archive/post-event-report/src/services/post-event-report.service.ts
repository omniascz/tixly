import { PostEventReport, PostEventReportSummary } from '../types/post-event-report.types';
import {
  calculateSellthroughPct,
  calculateNoShowPct,
  calculateAvgPrice,
  findPeakEntryTime,
  findAvgEntryTime,
  buildSalesByDay,
} from '../lib/report-calculator';

/**
 * Database adapter interface for post-event reports
 * Implementations should query the ticketing database
 */
export interface ReportDbAdapter {
  getEventDetails(eventId: string): Promise<{
    name: string;
    date: Date;
    capacity: number;
  } | null>;

  getSalesSummary(eventId: string): Promise<{
    total_sold: number;
    total_revenue: number;
    total_fees: number;
    by_type: Array<{ name: string; sold: number; revenue: number }>;
    by_zone: Array<{ zone: string; sold: number; capacity: number | null }>;
    orders: Array<{ created_at: Date; amount: number; quantity: number }>;
    first_sale_at: Date | null;
    last_sale_at: Date | null;
  }>;

  getAttendanceSummary(eventId: string): Promise<{
    total_checked_in: number;
    scan_timestamps: Date[];
    will_call_pickups: number;
    guest_list_total: number;
    guest_list_checked_in: number;
  }>;

  getFinanceSummary(eventId: string): Promise<{
    refunds_total: number;
    resale_volume: number;
    resale_commission: number;
    promo_discounts: number;
    installments_pending: number;
  }>;

  getMarketingSummary(eventId: string): Promise<{
    referral_sales: number;
    referral_revenue: number;
    promo_codes_used: number;
    top_promo_codes: Array<{ code: string; uses: number; discount_total: number }>;
    affiliate_sales: number;
    affiliate_revenue: number;
  }>;

  getResaleSummary(eventId: string): Promise<{
    total_listings: number;
    total_sold: number;
    prices: number[];
  }>;

  saveReport(report: PostEventReport): Promise<void>;

  getReport(eventId: string): Promise<PostEventReport | null>;

  listReportsByOrganizer(organizerId: string): Promise<PostEventReportSummary[]>;

  checkOrganizerOwnership(eventId: string, organizerId: string): Promise<boolean>;

  findEventsToReport(cutoffTime: Date): Promise<Array<{ id: string; ends_at: Date }>>;
}

/**
 * Service for generating and managing post-event reports
 */
export class PostEventReportService {
  /**
   * Generate a complete post-event report
   * Fetches all data in parallel for performance
   */
  async generateReport(eventId: string, db: ReportDbAdapter): Promise<PostEventReport> {
    // Fetch event details first to validate event exists
    const eventDetails = await db.getEventDetails(eventId);
    if (!eventDetails) {
      throw new Error(`Event not found: ${eventId}`);
    }

    // Fetch all sections in parallel
    const [sales, attendance, finance, marketing, resale] = await Promise.all([
      db.getSalesSummary(eventId),
      db.getAttendanceSummary(eventId),
      db.getFinanceSummary(eventId),
      db.getMarketingSummary(eventId),
      db.getResaleSummary(eventId),
    ]);

    const now = new Date();

    // Calculate derived metrics
    const sellthrough = calculateSellthroughPct(sales.total_sold, eventDetails.capacity);
    const noShowCount = sales.total_sold - attendance.total_checked_in;
    const noShowPct = calculateNoShowPct(attendance.total_checked_in, sales.total_sold);
    const avgTicketPrice = calculateAvgPrice(sales.total_revenue, sales.total_sold);

    // Calculate peak and avg entry times
    const peakEntryTime = findPeakEntryTime(attendance.scan_timestamps);
    const avgEntryTime = findAvgEntryTime(attendance.scan_timestamps);

    // Build sales by day
    const salesByDay = buildSalesByDay(sales.orders);

    // Calculate resale metrics
    const resaleAvgPrice = resale.total_sold > 0
      ? Math.round(resale.prices.reduce((a, b) => a + b, 0) / resale.prices.length)
      : 0;
    const resaleMaxPrice = resale.prices.length > 0
      ? Math.max(...resale.prices)
      : 0;
    const resaleSellthrough = resale.total_listings > 0
      ? calculateSellthroughPct(resale.total_sold, resale.total_listings)
      : 0;

    // Calculate organizer payout
    const grossRevenue = sales.total_revenue;
    const platformFees = sales.total_fees;
    const organizerPayout = grossRevenue - platformFees;

    const report: PostEventReport = {
      id: `report_${eventId}_${now.getTime()}`,
      event_id: eventId,
      event_name: eventDetails.name,
      event_date: eventDetails.date,
      generated_at: now,
      status: 'ready',

      sales: {
        total_tickets_sold: sales.total_sold,
        total_tickets_capacity: eventDetails.capacity,
        sellthrough_pct: sellthrough,
        total_revenue: sales.total_revenue,
        total_fees_collected: sales.total_fees,
        avg_ticket_price: avgTicketPrice,
        tickets_by_type: sales.by_type,
        tickets_by_zone: sales.by_zone,
        sales_by_day: salesByDay,
        first_sale_at: sales.first_sale_at,
        last_sale_at: sales.last_sale_at,
      },

      attendance: {
        total_checked_in: attendance.total_checked_in,
        no_show_count: noShowCount,
        no_show_pct: noShowPct,
        peak_entry_time: peakEntryTime,
        avg_entry_time: avgEntryTime,
        will_call_pickups: attendance.will_call_pickups,
        guest_list_total: attendance.guest_list_total,
        guest_list_checked_in: attendance.guest_list_checked_in,
      },

      finance: {
        gross_revenue: grossRevenue,
        platform_fees: platformFees,
        organizer_payout: organizerPayout,
        resale_volume: finance.resale_volume,
        resale_commission: finance.resale_commission,
        refunds_total: finance.refunds_total,
        promo_discounts_total: finance.promo_discounts,
        installments_pending: finance.installments_pending,
      },

      marketing: {
        referral_sales_count: marketing.referral_sales,
        referral_revenue: marketing.referral_revenue,
        promo_codes_used: marketing.promo_codes_used,
        top_promo_codes: marketing.top_promo_codes,
        affiliate_sales: marketing.affiliate_sales,
        affiliate_revenue: marketing.affiliate_revenue,
      },

      resale: {
        total_listings: resale.total_listings,
        total_sold: resale.total_sold,
        avg_resale_price: resaleAvgPrice,
        max_resale_price: resaleMaxPrice,
        resale_sellthrough_pct: resaleSellthrough,
      },
    };

    await db.saveReport(report);
    return report;
  }

  /**
   * Get an existing report
   * Checks organizer ownership
   */
  async getReport(
    eventId: string,
    organizerId: string,
    db: ReportDbAdapter
  ): Promise<PostEventReport> {
    const owns = await db.checkOrganizerOwnership(eventId, organizerId);
    if (!owns) {
      throw new Error('Unauthorized: organizer does not own this event');
    }

    const report = await db.getReport(eventId);
    if (!report) {
      throw new Error('Report not found');
    }

    return report;
  }

  /**
   * List all reports for an organizer
   */
  async listReports(organizerId: string, db: ReportDbAdapter): Promise<PostEventReportSummary[]> {
    return db.listReportsByOrganizer(organizerId);
  }

  /**
   * Process all events that have finished (ended 2+ hours ago)
   * Generates reports for events that don't have one yet
   * Returns count of newly generated reports
   */
  async processFinishedEvents(db: ReportDbAdapter): Promise<number> {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

    const finishedEvents = await db.findEventsToReport(cutoffTime);
    let generatedCount = 0;

    for (const event of finishedEvents) {
      try {
        const existingReport = await db.getReport(event.id);
        if (existingReport) {
          continue; // Report already exists
        }

        await this.generateReport(event.id, db);
        generatedCount++;
      } catch (error) {
        console.error(`Failed to generate report for event ${event.id}:`, error);
        // Continue with next event instead of failing
      }
    }

    return generatedCount;
  }
}
