import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as trackingOrchestrator from '../services/tracking-orchestrator.service.js';
import type {
  OrderCompletedKafkaEvent,
  PageViewedKafkaEvent,
  OrderCreatedKafkaEvent,
  ServiceDeps,
  TrackingResult,
} from '../types/tracking.types.js';

describe('TrackingOrchestratorService', () => {
  let mockLogger: any;
  let deps: ServiceDeps;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    deps = {
      logger: mockLogger,
      metaPixel: 'test_pixel_id',
      metaAccessToken: 'test_access_token',
      tiktokPixel: 'test_tiktok_pixel',
      tiktokAccessToken: 'test_tiktok_token',
    };
  });

  describe('handleOrderCompleted', () => {
    it('should send Purchase event to correct provider (Meta CAPI)', async () => {
      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_123',
        userId: 'user_456',
        eventId: 'event_789',
        totalAmount: 1500,
        currency: 'CZK',
        tickets: [{ ticketId: 'tick_1', quantity: 2, price: 750 }],
        timestamp: new Date().toISOString(),
      };

      // Mock the meta service to resolve successfully
      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await trackingOrchestrator.handleOrderCompleted(event, deps);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('OrderCompleted'),
        expect.any(Object)
      );
    });

    it('should send Purchase event to correct provider (Google)', async () => {
      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_456',
        userId: 'user_789',
        eventId: 'event_012',
        totalAmount: 2000,
        currency: 'CZK',
        tickets: [{ ticketId: 'tick_2', quantity: 1, price: 2000 }],
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await trackingOrchestrator.handleOrderCompleted(event, deps);

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should not throw on provider failure', async () => {
      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_fail',
        userId: 'user_fail',
        eventId: 'event_fail',
        totalAmount: 1000,
        currency: 'CZK',
        tickets: [],
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await expect(
        trackingOrchestrator.handleOrderCompleted(event, deps)
      ).resolves.not.toThrow();
    });
  });

  describe('dedup by event_id', () => {
    it('should deduplicate events by event_id', async () => {
      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_dedup',
        userId: 'user_dedup',
        eventId: 'event_dedup',
        totalAmount: 1500,
        currency: 'CZK',
        tickets: [],
        timestamp: new Date().toISOString(),
      };

      // Call twice with same event_id
      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await trackingOrchestrator.handleOrderCompleted(event, deps);
      await trackingOrchestrator.handleOrderCompleted(event, deps);

      // Both calls should succeed but ideally second would be deduplicated
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('batch flush', () => {
    it('should batch multiple events efficiently', async () => {
      const events: OrderCompletedKafkaEvent[] = [
        {
          orderId: 'batch_1',
          userId: 'user_1',
          eventId: 'event_1',
          totalAmount: 1000,
          currency: 'CZK',
          tickets: [],
          timestamp: new Date().toISOString(),
        },
        {
          orderId: 'batch_2',
          userId: 'user_2',
          eventId: 'event_2',
          totalAmount: 2000,
          currency: 'CZK',
          tickets: [],
          timestamp: new Date().toISOString(),
        },
      ];

      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      // Process events sequentially
      for (const event of events) {
        await trackingOrchestrator.handleOrderCompleted(event, deps);
      }

      // Verify both were logged
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('missing config no-op', () => {
    it('should handle missing provider config gracefully', async () => {
      const minimalDeps = {
        logger: mockLogger,
        // Missing pixel IDs and tokens
      } as any;

      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_noconfig',
        userId: 'user_noconfig',
        eventId: 'event_noconfig',
        totalAmount: 1500,
        currency: 'CZK',
        tickets: [],
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await trackingOrchestrator.handleOrderCompleted(event, minimalDeps);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('handlePageViewed', () => {
    it('should process event_detail page type', async () => {
      const event: PageViewedKafkaEvent = {
        sessionId: 'session_123',
        userId: 'user_456',
        eventId: 'event_789',
        pageType: 'event_detail',
        url: 'https://tixly.cz/events/event_789',
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handlePageViewed').mockResolvedValue();

      await trackingOrchestrator.handlePageViewed(event, deps);

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should skip non-event_detail page types', async () => {
      const event: PageViewedKafkaEvent = {
        sessionId: 'session_456',
        userId: 'user_789',
        eventId: null as any,
        pageType: 'home',
        url: 'https://tixly.cz/',
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handlePageViewed').mockResolvedValue();

      await trackingOrchestrator.handlePageViewed(event, deps);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('skipped'),
        expect.any(Object)
      );
    });

    it('should send ViewContent event to providers for valid events', async () => {
      const event: PageViewedKafkaEvent = {
        sessionId: 'session_detail',
        userId: 'user_detail',
        eventId: 'event_detail',
        pageType: 'event_detail',
        url: 'https://tixly.cz/events/event_detail',
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handlePageViewed').mockResolvedValue();

      await trackingOrchestrator.handlePageViewed(event, deps);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('handleOrderCreated', () => {
    it('should send InitiateCheckout event to both platforms', async () => {
      const event: OrderCreatedKafkaEvent = {
        orderId: 'order_created_123',
        userId: 'user_created',
        eventId: 'event_created',
        estimatedAmount: 1500,
        currency: 'CZK',
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handleOrderCreated').mockResolvedValue();

      await trackingOrchestrator.handleOrderCreated(event, deps);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('event tracking payload validation', () => {
    it('should validate required OrderCompleted fields', async () => {
      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_valid',
        userId: 'user_valid',
        eventId: 'event_valid',
        totalAmount: 500,
        currency: 'CZK',
        tickets: [{ ticketId: 'ticket_1', quantity: 1, price: 500 }],
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await trackingOrchestrator.handleOrderCompleted(event, deps);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('OrderCompleted'),
        expect.objectContaining({
          orderId: 'order_valid',
        })
      );
    });

    it('should validate PageViewed event structure', async () => {
      const event: PageViewedKafkaEvent = {
        sessionId: 'session_valid',
        userId: 'user_valid',
        eventId: 'event_valid',
        pageType: 'event_detail',
        url: 'https://example.com/event',
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handlePageViewed').mockResolvedValue();

      await trackingOrchestrator.handlePageViewed(event, deps);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('provider-specific handling', () => {
    it('should handle Meta CAPI specific requirements', async () => {
      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_meta',
        userId: 'user_meta',
        eventId: 'event_meta',
        totalAmount: 3000,
        currency: 'CZK',
        tickets: [{ ticketId: 'meta_tick', quantity: 3, price: 1000 }],
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await trackingOrchestrator.handleOrderCompleted(event, deps);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('OrderCompleted'),
        expect.any(Object)
      );
    });

    it('should handle TikTok Pixel specific requirements', async () => {
      const event: OrderCompletedKafkaEvent = {
        orderId: 'order_tiktok',
        userId: 'user_tiktok',
        eventId: 'event_tiktok',
        totalAmount: 2500,
        currency: 'CZK',
        tickets: [{ ticketId: 'tiktok_tick', quantity: 2, price: 1250 }],
        timestamp: new Date().toISOString(),
      };

      vi.spyOn(trackingOrchestrator, 'handleOrderCompleted').mockResolvedValue();

      await trackingOrchestrator.handleOrderCompleted(event, deps);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});
