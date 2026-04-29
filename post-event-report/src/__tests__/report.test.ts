import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostEventReportService, ReportDbAdapter } from '../services/post-event-report.service.js';
import type { PostEventReport } from '../types/post-event-report.types.js';

describe('PostEventReportService', () => {
  let service: PostEventReportService;
  let mockDb: ReportDbAdapter;

  beforeEach(() => {
    service = new PostEventReportService();
    mockDb = {
      getEventDetails: vi.fn(),
      getSalesSummary: vi.fn(),
      getAttendanceSummary: vi.fn(),
      getFinanceSummary: vi.fn(),
      getMarketingSummary: vi.fn(),
      getResaleSummary: vi.fn(),
      saveReport: vi.fn(),
      getReport: vi.fn(),
      listReportsByOrganizer: vi.fn(),
      checkOrganizerOwnership: vi.fn(),
      findEventsToReport: vi.fn(),
    };
  });

  describe('generateReport', () => {
    it('should return a report with correct structure', async () => {
      const eventId = 'event_123';
      const eventDate = new Date('2026-04-01');

      vi.mocked(mockDb.getEventDetails).mockResolvedValue({
        name: 'Test Concert',
        date: eventDate,
        capacity: 1000,
      });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 800,
        total_revenue: 50000,
        total_fees: 5000,
        by_type: [{ name: 'General', sold: 800, revenue: 50000 }],
        by_zone: [{ zone: 'Main', sold: 800, capacity: 1000 }],
        orders: [
          { created_at: eventDate, amount: 100, quantity: 2 },
          { created_at: eventDate, amount: 150, quantity: 3 },
        ],
        first_sale_at: eventDate,
        last_sale_at: eventDate,
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 750,
        scan_timestamps: [eventDate, eventDate],
        will_call_pickups: 50,
        guest_list_total: 10,
        guest_list_checked_in: 10,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 0,
        resale_volume: 0,
        resale_commission: 0,
        promo_discounts: 1000,
        installments_pending: 0,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 50,
        referral_revenue: 5000,
        promo_codes_used: 20,
        top_promo_codes: [],
        affiliate_sales: 10,
        affiliate_revenue: 1000,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 100,
        total_sold: 80,
        prices: [150, 160, 170],
      });

      const report = await service.generateReport(eventId, mockDb);

      expect(report).toBeDefined();
      expect(report.event_id).toBe(eventId);
      expect(report.event_name).toBe('Test Concert');
      expect(report.status).toBe('ready');
      expect(report.sales).toBeDefined();
      expect(report.attendance).toBeDefined();
      expect(report.finance).toBeDefined();
      expect(report.marketing).toBeDefined();
      expect(report.resale).toBeDefined();
      expect(vi.mocked(mockDb.saveReport)).toHaveBeenCalled();
    });

    it('should handle events with zero tickets sold', async () => {
      const eventId = 'event_empty';
      const eventDate = new Date('2026-04-01');

      vi.mocked(mockDb.getEventDetails).mockResolvedValue({
        name: 'Empty Event',
        date: eventDate,
        capacity: 1000,
      });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 0,
        total_revenue: 0,
        total_fees: 0,
        by_type: [],
        by_zone: [],
        orders: [],
        first_sale_at: null,
        last_sale_at: null,
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 0,
        scan_timestamps: [],
        will_call_pickups: 0,
        guest_list_total: 0,
        guest_list_checked_in: 0,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 0,
        resale_volume: 0,
        resale_commission: 0,
        promo_discounts: 0,
        installments_pending: 0,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 0,
        referral_revenue: 0,
        promo_codes_used: 0,
        top_promo_codes: [],
        affiliate_sales: 0,
        affiliate_revenue: 0,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 0,
        total_sold: 0,
        prices: [],
      });

      const report = await service.generateReport(eventId, mockDb);

      expect(report.sales.total_tickets_sold).toBe(0);
      expect(report.sales.sellthrough_pct).toBe(0);
      expect(report.sales.total_revenue).toBe(0);
      expect(report.attendance.total_checked_in).toBe(0);
    });

    it('should calculate revenue sum correctly', async () => {
      const eventId = 'event_revenue';
      const eventDate = new Date('2026-04-01');

      vi.mocked(mockDb.getEventDetails).mockResolvedValue({
        name: 'Revenue Test',
        date: eventDate,
        capacity: 500,
      });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 100,
        total_revenue: 10000,
        total_fees: 1000,
        by_type: [],
        by_zone: [],
        orders: [],
        first_sale_at: null,
        last_sale_at: null,
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 95,
        scan_timestamps: [],
        will_call_pickups: 0,
        guest_list_total: 0,
        guest_list_checked_in: 0,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 500,
        resale_volume: 2000,
        resale_commission: 200,
        promo_discounts: 0,
        installments_pending: 0,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 0,
        referral_revenue: 0,
        promo_codes_used: 0,
        top_promo_codes: [],
        affiliate_sales: 0,
        affiliate_revenue: 0,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 0,
        total_sold: 0,
        prices: [],
      });

      const report = await service.generateReport(eventId, mockDb);

      expect(report.finance.gross_revenue).toBe(10000);
      expect(report.finance.platform_fees).toBe(1000);
      expect(report.finance.organizer_payout).toBe(9000);
    });

    it('should throw error for non-existent event', async () => {
      vi.mocked(mockDb.getEventDetails).mockResolvedValue(null);

      await expect(
        service.generateReport('invalid_event', mockDb)
      ).rejects.toThrow('Event not found');
    });

    it('should compute resale metrics correctly', async () => {
      const eventId = 'event_resale';
      const eventDate = new Date('2026-04-01');

      vi.mocked(mockDb.getEventDetails).mockResolvedValue({
        name: 'Resale Test',
        date: eventDate,
        capacity: 500,
      });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 100,
        total_revenue: 10000,
        total_fees: 1000,
        by_type: [],
        by_zone: [],
        orders: [],
        first_sale_at: null,
        last_sale_at: null,
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 90,
        scan_timestamps: [],
        will_call_pickups: 0,
        guest_list_total: 0,
        guest_list_checked_in: 0,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 0,
        resale_volume: 5000,
        resale_commission: 500,
        promo_discounts: 0,
        installments_pending: 0,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 0,
        referral_revenue: 0,
        promo_codes_used: 0,
        top_promo_codes: [],
        affiliate_sales: 0,
        affiliate_revenue: 0,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 20,
        total_sold: 15,
        prices: [100, 200, 300],
      });

      const report = await service.generateReport(eventId, mockDb);

      expect(report.resale.total_listings).toBe(20);
      expect(report.resale.total_sold).toBe(15);
      expect(report.resale.avg_resale_price).toBe(200); // (100+200+300)/3
      expect(report.resale.max_resale_price).toBe(300);
      expect(report.resale.resale_sellthrough_pct).toBe(75); // 15/20*100
    });

    it('should handle resale with zero listings', async () => {
      const eventId = 'event_no_resale';
      const eventDate = new Date('2026-04-01');

      vi.mocked(mockDb.getEventDetails).mockResolvedValue({
        name: 'No Resale',
        date: eventDate,
        capacity: 100,
      });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 50,
        total_revenue: 5000,
        total_fees: 500,
        by_type: [],
        by_zone: [],
        orders: [],
        first_sale_at: null,
        last_sale_at: null,
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 45,
        scan_timestamps: [],
        will_call_pickups: 0,
        guest_list_total: 0,
        guest_list_checked_in: 0,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 0,
        resale_volume: 0,
        resale_commission: 0,
        promo_discounts: 0,
        installments_pending: 0,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 0,
        referral_revenue: 0,
        promo_codes_used: 0,
        top_promo_codes: [],
        affiliate_sales: 0,
        affiliate_revenue: 0,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 0,
        total_sold: 0,
        prices: [],
      });

      const report = await service.generateReport(eventId, mockDb);

      expect(report.resale.avg_resale_price).toBe(0);
      expect(report.resale.max_resale_price).toBe(0);
      expect(report.resale.resale_sellthrough_pct).toBe(0);
    });

    it('should populate marketing section correctly', async () => {
      const eventId = 'event_mkt';
      const eventDate = new Date('2026-04-01');

      vi.mocked(mockDb.getEventDetails).mockResolvedValue({
        name: 'Marketing Test',
        date: eventDate,
        capacity: 200,
      });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 100,
        total_revenue: 10000,
        total_fees: 1000,
        by_type: [{ name: 'VIP', sold: 100, revenue: 10000 }],
        by_zone: [{ zone: 'Zone A', sold: 100, capacity: 200 }],
        orders: [],
        first_sale_at: new Date('2026-03-01'),
        last_sale_at: new Date('2026-03-31'),
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 95,
        scan_timestamps: [],
        will_call_pickups: 5,
        guest_list_total: 10,
        guest_list_checked_in: 8,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 200,
        resale_volume: 0,
        resale_commission: 0,
        promo_discounts: 500,
        installments_pending: 300,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 25,
        referral_revenue: 2500,
        promo_codes_used: 15,
        top_promo_codes: [{ code: 'SUMMER', uses: 10, discount_total: 400 }],
        affiliate_sales: 5,
        affiliate_revenue: 500,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 0,
        total_sold: 0,
        prices: [],
      });

      const report = await service.generateReport(eventId, mockDb);

      expect(report.marketing.referral_sales_count).toBe(25);
      expect(report.marketing.referral_revenue).toBe(2500);
      expect(report.marketing.promo_codes_used).toBe(15);
      expect(report.marketing.top_promo_codes).toHaveLength(1);
      expect(report.marketing.top_promo_codes[0].code).toBe('SUMMER');
      expect(report.marketing.affiliate_sales).toBe(5);
      expect(report.marketing.affiliate_revenue).toBe(500);

      // Also verify attendance details
      expect(report.attendance.will_call_pickups).toBe(5);
      expect(report.attendance.guest_list_total).toBe(10);
      expect(report.attendance.guest_list_checked_in).toBe(8);

      // Verify finance details
      expect(report.finance.refunds_total).toBe(200);
      expect(report.finance.promo_discounts_total).toBe(500);
      expect(report.finance.installments_pending).toBe(300);

      // Verify sales details
      expect(report.sales.tickets_by_type).toHaveLength(1);
      expect(report.sales.tickets_by_zone).toHaveLength(1);
      expect(report.sales.first_sale_at).toEqual(new Date('2026-03-01'));
      expect(report.sales.last_sale_at).toEqual(new Date('2026-03-31'));
    });
  });

  describe('getReport', () => {
    it('should return report for authorized organizer', async () => {
      const eventId = 'event_456';
      const organizerId = 'org_123';
      const mockReport: PostEventReport = {
        id: 'report_id',
        event_id: eventId,
        event_name: 'Test Event',
        event_date: new Date(),
        generated_at: new Date(),
        status: 'ready',
        sales: {
          total_tickets_sold: 100,
          total_tickets_capacity: 500,
          sellthrough_pct: 20,
          total_revenue: 5000,
          total_fees_collected: 500,
          avg_ticket_price: 50,
          tickets_by_type: [],
          tickets_by_zone: [],
          sales_by_day: [],
          first_sale_at: null,
          last_sale_at: null,
        },
        attendance: {
          total_checked_in: 90,
          no_show_count: 10,
          no_show_pct: 10,
          peak_entry_time: new Date(),
          avg_entry_time: new Date(),
          will_call_pickups: 0,
          guest_list_total: 0,
          guest_list_checked_in: 0,
        },
        finance: {
          gross_revenue: 5000,
          platform_fees: 500,
          organizer_payout: 4500,
          resale_volume: 0,
          resale_commission: 0,
          refunds_total: 0,
          promo_discounts_total: 0,
          installments_pending: 0,
        },
        marketing: {
          referral_sales_count: 0,
          referral_revenue: 0,
          promo_codes_used: 0,
          top_promo_codes: [],
          affiliate_sales: 0,
          affiliate_revenue: 0,
        },
        resale: {
          total_listings: 0,
          total_sold: 0,
          avg_resale_price: 0,
          max_resale_price: 0,
          resale_sellthrough_pct: 0,
        },
      };

      vi.mocked(mockDb.checkOrganizerOwnership).mockResolvedValue(true);
      vi.mocked(mockDb.getReport).mockResolvedValue(mockReport);

      const report = await service.getReport(eventId, organizerId, mockDb);

      expect(report).toEqual(mockReport);
      expect(vi.mocked(mockDb.checkOrganizerOwnership)).toHaveBeenCalledWith(eventId, organizerId);
    });

    it('should throw error for unauthorized organizer', async () => {
      vi.mocked(mockDb.checkOrganizerOwnership).mockResolvedValue(false);

      await expect(
        service.getReport('event_456', 'wrong_org', mockDb)
      ).rejects.toThrow('Unauthorized');
    });

    it('should throw error when report does not exist', async () => {
      vi.mocked(mockDb.checkOrganizerOwnership).mockResolvedValue(true);
      vi.mocked(mockDb.getReport).mockResolvedValue(null);

      await expect(
        service.getReport('event_456', 'org_123', mockDb)
      ).rejects.toThrow('Report not found');
    });
  });

  describe('listReports', () => {
    it('should return list of reports for organizer', async () => {
      const organizerId = 'org_123';
      const summaries = [
        {
          id: 'report_1',
          event_id: 'event_1',
          event_name: 'Event 1',
          event_date: new Date(),
          generated_at: new Date(),
          total_revenue: 5000,
          sellthrough_pct: 80,
        },
      ];

      vi.mocked(mockDb.listReportsByOrganizer).mockResolvedValue(summaries);

      const result = await service.listReports(organizerId, mockDb);

      expect(result).toEqual(summaries);
      expect(vi.mocked(mockDb.listReportsByOrganizer)).toHaveBeenCalledWith(organizerId);
    });
  });

  describe('processFinishedEvents', () => {
    it('should generate reports for finished events without reports', async () => {
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([
        { id: 'event_1', ends_at: cutoffTime },
        { id: 'event_2', ends_at: cutoffTime },
      ]);

      vi.mocked(mockDb.getReport)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      vi.mocked(mockDb.getEventDetails).mockResolvedValue({
        name: 'Test',
        date: new Date(),
        capacity: 100,
      });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 0,
        total_revenue: 0,
        total_fees: 0,
        by_type: [],
        by_zone: [],
        orders: [],
        first_sale_at: null,
        last_sale_at: null,
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 0,
        scan_timestamps: [],
        will_call_pickups: 0,
        guest_list_total: 0,
        guest_list_checked_in: 0,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 0,
        resale_volume: 0,
        resale_commission: 0,
        promo_discounts: 0,
        installments_pending: 0,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 0,
        referral_revenue: 0,
        promo_codes_used: 0,
        top_promo_codes: [],
        affiliate_sales: 0,
        affiliate_revenue: 0,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 0,
        total_sold: 0,
        prices: [],
      });

      const count = await service.processFinishedEvents(mockDb);

      expect(count).toBe(2);
      expect(vi.mocked(mockDb.saveReport).mock.calls.length).toBeGreaterThan(0);
    });

    it('should skip events that already have reports', async () => {
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([
        { id: 'event_1', ends_at: cutoffTime },
      ]);

      vi.mocked(mockDb.getReport).mockResolvedValue({} as any);

      const count = await service.processFinishedEvents(mockDb);

      expect(count).toBe(0);
    });

    it('should continue processing when one event fails', async () => {
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([
        { id: 'event_fail', ends_at: cutoffTime },
        { id: 'event_ok', ends_at: cutoffTime },
      ]);

      // First event: no existing report, but getEventDetails fails
      // Second event: no existing report, succeeds
      vi.mocked(mockDb.getReport)
        .mockResolvedValueOnce(null) // event_fail has no report
        .mockResolvedValueOnce(null); // event_ok has no report

      vi.mocked(mockDb.getEventDetails)
        .mockRejectedValueOnce(new Error('DB error on event_fail'))
        .mockResolvedValueOnce({
          name: 'OK Event',
          date: new Date(),
          capacity: 100,
        });

      vi.mocked(mockDb.getSalesSummary).mockResolvedValue({
        total_sold: 0,
        total_revenue: 0,
        total_fees: 0,
        by_type: [],
        by_zone: [],
        orders: [],
        first_sale_at: null,
        last_sale_at: null,
      });

      vi.mocked(mockDb.getAttendanceSummary).mockResolvedValue({
        total_checked_in: 0,
        scan_timestamps: [],
        will_call_pickups: 0,
        guest_list_total: 0,
        guest_list_checked_in: 0,
      });

      vi.mocked(mockDb.getFinanceSummary).mockResolvedValue({
        refunds_total: 0,
        resale_volume: 0,
        resale_commission: 0,
        promo_discounts: 0,
        installments_pending: 0,
      });

      vi.mocked(mockDb.getMarketingSummary).mockResolvedValue({
        referral_sales: 0,
        referral_revenue: 0,
        promo_codes_used: 0,
        top_promo_codes: [],
        affiliate_sales: 0,
        affiliate_revenue: 0,
      });

      vi.mocked(mockDb.getResaleSummary).mockResolvedValue({
        total_listings: 0,
        total_sold: 0,
        prices: [],
      });

      const count = await service.processFinishedEvents(mockDb);

      // Only one should succeed
      expect(count).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('event_fail'),
        expect.any(Error)
      );
    });

    it('should return 0 when no finished events exist', async () => {
      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([]);

      const count = await service.processFinishedEvents(mockDb);

      expect(count).toBe(0);
    });
  });
});
