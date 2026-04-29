import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processFinishedEventsJob, initializePostEventReportJob } from './post-event-report.job';
import type { ReportDbAdapter } from '../services/post-event-report.service';

function createMockDb(): ReportDbAdapter {
  return {
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
}

function setupMockDbForGeneration(mockDb: ReportDbAdapter) {
  vi.mocked(mockDb.getEventDetails).mockResolvedValue({
    name: 'Test Event',
    date: new Date('2026-04-01'),
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

  vi.mocked(mockDb.saveReport).mockResolvedValue(undefined);
}

describe('post-event-report.job', () => {
  let mockDb: ReportDbAdapter;

  beforeEach(() => {
    mockDb = createMockDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processFinishedEventsJob', () => {
    it('should call processFinishedEvents and log count', async () => {
      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([
        { id: 'event_1', ends_at: new Date() },
      ]);
      vi.mocked(mockDb.getReport).mockResolvedValue(null);
      setupMockDbForGeneration(mockDb);

      await processFinishedEventsJob(mockDb);

      expect(mockDb.findEventsToReport).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Successfully generated 1 report(s)')
      );
    });

    it('should log zero when no events need reports', async () => {
      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([]);

      await processFinishedEventsJob(mockDb);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Successfully generated 0 report(s)')
      );
    });

    it('should log error when processFinishedEvents throws', async () => {
      vi.mocked(mockDb.findEventsToReport).mockRejectedValue(new Error('DB connection failed'));

      await processFinishedEventsJob(mockDb);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error processing finished events'),
        expect.any(Error)
      );
    });

    it('should reset isRunning flag after error', async () => {
      vi.mocked(mockDb.findEventsToReport).mockRejectedValue(new Error('DB error'));

      await processFinishedEventsJob(mockDb);

      // Should be able to run again (not stuck in "already running" state)
      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([]);
      await processFinishedEventsJob(mockDb);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Successfully generated 0 report(s)')
      );
    });
  });

  describe('initializePostEventReportJob', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should run job immediately on initialization', async () => {
      vi.useFakeTimers();
      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([]);

      const timer = initializePostEventReportJob(mockDb, 60000);

      // Flush microtasks for the initial async call without advancing setInterval
      await vi.advanceTimersByTimeAsync(0);

      expect(mockDb.findEventsToReport).toHaveBeenCalled();

      clearInterval(timer);
    });

    it('should return a timer that can be cleared', () => {
      vi.useFakeTimers();
      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([]);

      const timer = initializePostEventReportJob(mockDb, 60000);

      expect(timer).toBeDefined();

      clearInterval(timer);
    });

    it('should log initialization message', () => {
      vi.useFakeTimers();
      vi.mocked(mockDb.findEventsToReport).mockResolvedValue([]);

      const timer = initializePostEventReportJob(mockDb, 60000);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Initializing job')
      );

      clearInterval(timer);
    });
  });
});
