/**
 * Health check system - monitoring and uptime endpoints
 * Exports all health check types and services
 */

// Types
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
export type {
  HealthStatus,
  HealthCheck,
  HealthCheckResult,
  ServiceHealth,
  SystemHealth,
  ExternalApiCheck,
  ExternalApiCheckRequest,
  ExternalApiCheckResponse,
  DatabaseHealthResponse,
  RedisHealthResponse,
} from './types';

// Service functions
export {
  checkDatabaseHealth,
  checkRedisHealth,
  checkExternalApi,
  checkExternalApis,
  calculateOverallStatus,
  determineServiceStatus,
  getSystemHealth,
} from './health.service';

// Integration helpers
export {
  initializeDatabaseClient,
  initializeRedisClient,
  getConfiguredExternalApis,
  getHealthCheckConfig,
  getHealthCheckClients,
} from './health.integration';
