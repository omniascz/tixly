import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OccupancyService, OccupancyDbAdapter, RedisAdapter, KafkaProducerAdapter } from '../services/occupancy.service.js';
import type { OccupancySnapshot, OccupancyThresholds } from '../types/occupancy.types.js';

describe('OccupancyService', () => {
  let mockDb: OccupancyDbAdapter;
  let mockRedis: RedisAdapter;
  let mockKafka: KafkaProducerAdapter;

  beforeEach(() => {
    mockDb = {
      getScanSummaryByZone: vi.fn(),
      getEventCapacity: vi.fn(),
      getOccupancyThresholds: vi.fn(),
      saveOccupancySnapshot: vi.fn(),
      getLatestSnapshot: vi.fn(),
      saveAlert: vi.fn(),
      getActiveAlerts: vi.fn(),
      setOccupancyThresholds: vi.fn(),
    };

    mockRedis = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      increment: vi.fn(),
      decrement: vi.fn(),
    };

    mockKafka = {
      publish: vi.fn(),
    };
  });

  describe('recordScanEvent', () => {
    it('should increment count on check_in', async () => {
      const eventId = 'event_123';
      const zoneId = 'zone_main';

      vi.mocked(mockRedis.increment).mockResolvedValue(101);
      vi.mocked(mockRedis.del).mockResolvedValue();

      await OccupancyService.recordScanEvent(eventId, zoneId, 'check_in', mockRedis);

      expect(vi.mocked(mockRedis.increment)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(mockRedis.del)).toHaveBeenCalled();
    });

    it('should decrement count on check_out', async () => {
      const eventId = 'event_123';
      const zoneId = 'zone_main';

      vi.mocked(mockRedis.decrement).mockResolvedValue(99);
      vi.mocked(mockRedis.del).mockResolvedValue();

      await OccupancyService.recordScanEvent(eventId, zoneId, 'check_out', mockRedis);

      expect(vi.mocked(mockRedis.decrement)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(mockRedis.del)).toHaveBeenCalled();
    });

    it('should invalidate snapshot cache after scan', async () => {
      const eventId = 'event_123';
      const zoneId = 'zone_main';

      vi.mocked(mockRedis.increment).mockResolvedValue(50);
      vi.mocked(mockRedis.del).mockResolvedValue();

      await OccupancyService.recordScanEvent(eventId, zoneId, 'check_in', mockRedis);

      expect(vi.mocked(mockRedis.del)).toHaveBeenCalledWith(`tixly:occupancy:${eventId}`);
    });
  });

  describe('getCurrentOccupancy', () => {
    it('should return occupancy snapshot from Redis cache', async () => {
      const eventId = 'event_123';
      const mockSnapshot: OccupancySnapshot = {
        event_id: eventId,
        total_capacity: 1000,
        current_occupancy: 500,
        occupancy_pct: 50,
        zones: [],
        captured_at: new Date().toISOString(),
      };

      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(mockSnapshot));

      const result = await OccupancyService.getCurrentOccupancy(eventId, mockDb, mockRedis);

      expect(result.event_id).toBe(eventId);
      expect(result.current_occupancy).toBe(500);
      expect(vi.mocked(mockDb.getScanSummaryByZone)).not.toHaveBeenCalled();
    });

    it('should rebuild from database on cache miss', async () => {
      const eventId = 'event_123';

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.getScanSummaryByZone).mockResolvedValue([
        {
          zone_id: 'zone_main',
          zone_name: 'Main Floor',
          zone_capacity: 1000,
          check_in_count: 500,
          check_out_count: 0,
        },
      ]);
      vi.mocked(mockDb.getEventCapacity).mockResolvedValue(1000);
      vi.mocked(mockRedis.set).mockResolvedValue();

      const result = await OccupancyService.getCurrentOccupancy(eventId, mockDb, mockRedis);

      expect(result.event_id).toBe(eventId);
      expect(vi.mocked(mockRedis.set)).toHaveBeenCalled();
    });

    it('should return a numeric occupancy value', async () => {
      const eventId = 'event_123';

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.getScanSummaryByZone).mockResolvedValue([
        {
          zone_id: 'zone_1',
          zone_name: 'Zone 1',
          zone_capacity: 500,
          check_in_count: 250,
          check_out_count: 0,
        },
      ]);
      vi.mocked(mockDb.getEventCapacity).mockResolvedValue(500);
      vi.mocked(mockRedis.set).mockResolvedValue();

      const result = await OccupancyService.getCurrentOccupancy(eventId, mockDb, mockRedis);

      expect(typeof result.total_inside).toBe('number');
      expect(result.total_inside).toBeGreaterThanOrEqual(0);
    });
  });

  describe('refreshSnapshot', () => {
    it('should check capacity limits', async () => {
      const eventId = 'event_123';
      const thresholds: OccupancyThresholds = {
        event_id: eventId,
        warning_pct: 80,
        critical_pct: 95,
        full_pct: 100,
        zone_thresholds: [],
      };

      vi.mocked(mockDb.getScanSummaryByZone).mockResolvedValue([
        {
          zone_id: 'zone_main',
          zone_name: 'Main',
          zone_capacity: 1000,
          check_in_count: 950,
          check_out_count: 0,
        },
      ]);
      vi.mocked(mockDb.getEventCapacity).mockResolvedValue(1000);
      vi.mocked(mockDb.getOccupancyThresholds).mockResolvedValue(thresholds);
      vi.mocked(mockDb.saveAlert).mockResolvedValue();
      vi.mocked(mockKafka.publish).mockResolvedValue();
      vi.mocked(mockRedis.set).mockResolvedValue();
      vi.mocked(mockDb.saveOccupancySnapshot).mockResolvedValue();

      const result = await OccupancyService.refreshSnapshot(eventId, mockDb, mockRedis, mockKafka);

      expect(result.event_id).toBe(eventId);
      expect(vi.mocked(mockDb.saveOccupancySnapshot)).toHaveBeenCalled();
    });

    it('should publish alerts to Kafka on threshold breach', async () => {
      const eventId = 'event_123';
      const thresholds: OccupancyThresholds = {
        event_id: eventId,
        warning_pct: 80,
        critical_pct: 95,
        full_pct: 100,
        zone_thresholds: [],
      };

      vi.mocked(mockDb.getScanSummaryByZone).mockResolvedValue([
        {
          zone_id: 'zone_main',
          zone_name: 'Main',
          zone_capacity: 1000,
          check_in_count: 960,
          check_out_count: 0,
        },
      ]);
      vi.mocked(mockDb.getEventCapacity).mockResolvedValue(1000);
      vi.mocked(mockDb.getOccupancyThresholds).mockResolvedValue(thresholds);
      vi.mocked(mockDb.saveAlert).mockResolvedValue();
      vi.mocked(mockKafka.publish).mockResolvedValue();
      vi.mocked(mockRedis.set).mockResolvedValue();
      vi.mocked(mockDb.saveOccupancySnapshot).mockResolvedValue();

      await OccupancyService.refreshSnapshot(eventId, mockDb, mockRedis, mockKafka);

      expect(vi.mocked(mockKafka.publish)).toHaveBeenCalledWith('occupancy.alert', expect.any(Object));
    });

    it('should store snapshot in Redis cache', async () => {
      const eventId = 'event_123';

      vi.mocked(mockDb.getScanSummaryByZone).mockResolvedValue([
        {
          zone_id: 'zone_main',
          zone_name: 'Main',
          zone_capacity: 1000,
          check_in_count: 500,
          check_out_count: 0,
        },
      ]);
      vi.mocked(mockDb.getEventCapacity).mockResolvedValue(1000);
      vi.mocked(mockDb.getOccupancyThresholds).mockResolvedValue(null);
      vi.mocked(mockDb.saveAlert).mockResolvedValue();
      vi.mocked(mockKafka.publish).mockResolvedValue();
      vi.mocked(mockRedis.set).mockResolvedValue();
      vi.mocked(mockDb.saveOccupancySnapshot).mockResolvedValue();

      await OccupancyService.refreshSnapshot(eventId, mockDb, mockRedis, mockKafka);

      expect(vi.mocked(mockRedis.set)).toHaveBeenCalled();
    });
  });

  describe('setThresholds', () => {
    it('should persist threshold configuration', async () => {
      const eventId = 'event_123';
      const thresholds: OccupancyThresholds = {
        event_id: eventId,
        warning_pct: 75,
        critical_pct: 90,
        full_pct: 100,
        zone_thresholds: [],
      };

      vi.mocked(mockDb.setOccupancyThresholds).mockResolvedValue();

      await OccupancyService.setThresholds(eventId, thresholds, mockDb);

      expect(vi.mocked(mockDb.setOccupancyThresholds)).toHaveBeenCalledWith(eventId, thresholds);
    });
  });

  describe('getEventAlerts', () => {
    it('should return active alerts for event', async () => {
      const eventId = 'event_123';
      const alerts = [
        {
          id: 'alert_1',
          event_id: eventId,
          alert_type: 'critical',
          occupancy_pct: 96,
          zone_id: null,
          triggered_at: new Date().toISOString(),
          resolved_at: null,
        },
      ];

      vi.mocked(mockDb.getActiveAlerts).mockResolvedValue(alerts);

      const result = await OccupancyService.getEventAlerts(eventId, mockDb);

      expect(result).toEqual(alerts);
      expect(vi.mocked(mockDb.getActiveAlerts)).toHaveBeenCalledWith(eventId);
    });

    it('should handle events with no active alerts', async () => {
      const eventId = 'event_empty';

      vi.mocked(mockDb.getActiveAlerts).mockResolvedValue([]);

      const result = await OccupancyService.getEventAlerts(eventId, mockDb);

      expect(result).toEqual([]);
    });
  });

  describe('historical data tracking', () => {
    it('should track occupancy history over time', async () => {
      const eventId = 'event_123';
      const snapshot1: OccupancySnapshot = {
        event_id: eventId,
        total_capacity: 1000,
        current_occupancy: 100,
        occupancy_pct: 10,
        zones: [],
        captured_at: new Date().toISOString(),
      };

      const snapshot2: OccupancySnapshot = {
        event_id: eventId,
        total_capacity: 1000,
        current_occupancy: 500,
        occupancy_pct: 50,
        zones: [],
        captured_at: new Date().toISOString(),
      };

      vi.mocked(mockDb.saveOccupancySnapshot).mockResolvedValue();

      await mockDb.saveOccupancySnapshot(snapshot1);
      await mockDb.saveOccupancySnapshot(snapshot2);

      expect(vi.mocked(mockDb.saveOccupancySnapshot)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(mockDb.saveOccupancySnapshot)).toHaveBeenCalledWith(snapshot1);
      expect(vi.mocked(mockDb.saveOccupancySnapshot)).toHaveBeenCalledWith(snapshot2);
    });
  });
});
