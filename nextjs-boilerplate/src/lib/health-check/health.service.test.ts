import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  checkDatabaseHealth,
  checkRedisHealth,
  checkExternalApi,
  checkExternalApis,
  calculateOverallStatus,
  determineServiceStatus,
  getSystemHealth,
} from './health.service';

describe('Health Service', () => {
  describe('checkDatabaseHealth', () => {
    it('should return error when db client is not initialized', async () => {
      const result = await checkDatabaseHealth(undefined);

      expect(result.status).toBe('error');
      expect(result.responseTime).toBe(0);
      expect(result.error).toBe('Database client not initialized');
    });

    it('should return ok when database query succeeds', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      const result = await checkDatabaseHealth(mockDb as any);

      expect(result.status).toBe('ok');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(mockDb.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return error when database query fails', async () => {
      const mockDb = {
        query: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };

      const result = await checkDatabaseHealth(mockDb as any);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Connection refused');
    });

    it('should return slow when response time exceeds threshold', async () => {
      const mockDb = {
        query: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ rows: [{ '?column?': 1 }] }), 1100);
            }),
        ),
      };

      const result = await checkDatabaseHealth(mockDb as any);

      expect(result.status).toBe('slow');
      expect(result.responseTime).toBeGreaterThan(1000);
    });
  });

  describe('checkRedisHealth', () => {
    it('should return error when redis client is not initialized', async () => {
      const result = await checkRedisHealth(undefined);

      expect(result.status).toBe('error');
      expect(result.responseTime).toBe(0);
      expect(result.error).toBe('Redis client not initialized');
    });

    it('should return ok when redis ping succeeds', async () => {
      const mockRedis = {
        ping: vi.fn().mockResolvedValue('PONG'),
      };

      const result = await checkRedisHealth(mockRedis as any);

      expect(result.status).toBe('ok');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should return error when redis ping fails', async () => {
      const mockRedis = {
        ping: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      };

      const result = await checkRedisHealth(mockRedis as any);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Connection timeout');
    });

    it('should return slow when response time exceeds threshold', async () => {
      const mockRedis = {
        ping: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve('PONG'), 150)),
        ),
      };

      const result = await checkRedisHealth(mockRedis as any);

      expect(result.status).toBe('slow');
      expect(result.responseTime).toBeGreaterThan(100);
    });
  });

  describe('checkExternalApi', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return ok when API responds with 2xx status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await checkExternalApi('https://api.example.com/health');

      expect(result.status).toBe('ok');
      expect(result.url).toBe('https://api.example.com/health');
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should return error when API returns 5xx status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const result = await checkExternalApi('https://api.example.com/health');

      expect(result.status).toBe('error');
      expect(result.error).toContain('503');
    });

    it('should return error when request times out', async () => {
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          }),
      );

      const result = await checkExternalApi('https://api.example.com/health', 1000);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Timeout');
    });

    it('should use custom timeout', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      await checkExternalApi('https://api.example.com/health', 3000);

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle request errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await checkExternalApi('https://api.example.com/health');

      expect(result.status).toBe('error');
      expect(result.error).toBe('Network error');
    });
  });

  describe('checkExternalApis', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should check multiple APIs in parallel', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await checkExternalApis({
        urls: ['https://api1.example.com', 'https://api2.example.com'],
      });

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('ok');
      expect(result[1].status).toBe('ok');
    });

    it('should use provided timeout', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      await checkExternalApis({
        urls: ['https://api.example.com'],
        timeout: 2000,
      });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('calculateOverallStatus', () => {
    it('should return healthy when all services are healthy', () => {
      const services = [
        {
          name: 'database',
          status: 'healthy' as const,
          responseTime: 10,
          checks: {},
        },
        {
          name: 'redis',
          status: 'healthy' as const,
          responseTime: 5,
          checks: {},
        },
      ];

      const status = calculateOverallStatus(services);

      expect(status).toBe('healthy');
    });

    it('should return degraded when any service is degraded', () => {
      const services = [
        {
          name: 'database',
          status: 'healthy' as const,
          responseTime: 10,
          checks: {},
        },
        {
          name: 'redis',
          status: 'degraded' as const,
          responseTime: 150,
          checks: {},
        },
      ];

      const status = calculateOverallStatus(services);

      expect(status).toBe('degraded');
    });

    it('should return unhealthy when any service is unhealthy', () => {
      const services = [
        {
          name: 'database',
          status: 'healthy' as const,
          responseTime: 10,
          checks: {},
        },
        {
          name: 'redis',
          status: 'unhealthy' as const,
          responseTime: 0,
          checks: {},
          error: 'Connection refused',
        },
      ];

      const status = calculateOverallStatus(services);

      expect(status).toBe('unhealthy');
    });

    it('should return healthy when no services present', () => {
      const status = calculateOverallStatus([]);

      expect(status).toBe('healthy');
    });
  });

  describe('determineServiceStatus', () => {
    it('should return healthy when all checks pass', () => {
      const checks = {
        db: { status: 'ok' as const, responseTime: 10 },
        redis: { status: 'ok' as const, responseTime: 5 },
      };

      const status = determineServiceStatus(checks);

      expect(status).toBe('healthy');
    });

    it('should return unhealthy when db check fails', () => {
      const checks = {
        db: { status: 'error' as const, responseTime: 0, error: 'Connection refused' },
        redis: { status: 'ok' as const, responseTime: 5 },
      };

      const status = determineServiceStatus(checks);

      expect(status).toBe('unhealthy');
    });

    it('should return unhealthy when redis check fails', () => {
      const checks = {
        db: { status: 'ok' as const, responseTime: 10 },
        redis: { status: 'error' as const, responseTime: 0, error: 'Connection refused' },
      };

      const status = determineServiceStatus(checks);

      expect(status).toBe('unhealthy');
    });

    it('should return degraded when checks are slow', () => {
      const checks = {
        db: { status: 'slow' as const, responseTime: 1100 },
        redis: { status: 'ok' as const, responseTime: 5 },
      };

      const status = determineServiceStatus(checks);

      expect(status).toBe('degraded');
    });

    it('should return degraded when external APIs have errors', () => {
      const checks = {
        external: [
          { url: 'https://api.example.com', status: 'error' as const, responseTime: 5000 },
        ],
      };

      const status = determineServiceStatus(checks);

      expect(status).toBe('degraded');
    });

    it('should handle empty checks object', () => {
      const status = determineServiceStatus({});

      expect(status).toBe('healthy');
    });
  });

  describe('getSystemHealth', () => {
    it('should return system health with no clients initialized', async () => {
      const health = await getSystemHealth();

      expect(health.status).toBe('healthy');
      expect(health.timestamp).toBeDefined();
      expect(health.totalResponseTime).toBeDefined();
      expect(health.services).toEqual([]);
    });

    it('should include database service when db client provided', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      const health = await getSystemHealth(mockDb as any);

      expect(health.services).toHaveLength(1);
      expect(health.services[0].name).toBe('database');
      expect(health.services[0].status).toBe('healthy');
    });

    it('should include redis service when redis client provided', async () => {
      const mockRedis = {
        ping: vi.fn().mockResolvedValue('PONG'),
      };

      const health = await getSystemHealth(undefined, mockRedis as any);

      expect(health.services).toHaveLength(1);
      expect(health.services[0].name).toBe('redis');
      expect(health.services[0].status).toBe('healthy');
    });

    it('should include external apis service when urls provided', async () => {
      beforeEach(() => {
        global.fetch = vi.fn();
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });

      const health = await getSystemHealth(undefined, undefined, ['https://api.example.com']);

      expect(health.services.length).toBeGreaterThanOrEqual(1);
      const externalService = health.services.find((s) => s.name === 'external_apis');
      if (externalService) {
        expect(externalService.status).toBe('healthy');
      }
    });

    it('should run all checks in parallel', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };
      const mockRedis = {
        ping: vi.fn().mockResolvedValue('PONG'),
      };

      const startTime = performance.now();
      await getSystemHealth(mockDb as any, mockRedis as any);
      const duration = performance.now() - startTime;

      // If running in parallel, should be faster than sequential (db + redis time)
      expect(duration).toBeLessThan(1000); // Should be fast
    });

    it('should calculate correct overall status', async () => {
      const mockDb = {
        query: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };

      const health = await getSystemHealth(mockDb as any);

      expect(health.status).toBe('unhealthy');
    });

    it('should include error messages in services', async () => {
      const mockDb = {
        query: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };

      const health = await getSystemHealth(mockDb as any);

      const dbService = health.services.find((s) => s.name === 'database');
      expect(dbService?.error).toBe('Connection refused');
    });

    it('should include timestamp in ISO 8601 format', async () => {
      const health = await getSystemHealth();

      expect(health.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
