/**
 * Health check types for monitoring system health and services
 * Compatible with BetterStack, UptimeRobot, Datadog, and Prometheus
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheck {
  db?: HealthCheckResult;
  redis?: HealthCheckResult;
  external?: HealthCheckResult[];
}

export interface HealthCheckResult {
  status: 'ok' | 'error' | 'slow';
  responseTime: number; // ms
  error?: string;
}

export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  responseTime: number; // ms
  checks: HealthCheck;
  error?: string;
}

export interface SystemHealth {
  status: HealthStatus;
  timestamp: string; // ISO 8601
  totalResponseTime: number; // ms
  services: ServiceHealth[];
}

export interface ExternalApiCheck {
  url: string;
  status: 'ok' | 'error' | 'slow';
  responseTime: number;
  error?: string;
}

export interface ExternalApiCheckRequest {
  urls: string[];
  timeout?: number; // ms, default 5000
}

export interface ExternalApiCheckResponse {
  status: HealthStatus;
  checks: ExternalApiCheck[];
  totalResponseTime: number;
}

export interface DatabaseHealthResponse {
  status: 'ok' | 'error' | 'slow';
  responseTime: number;
  error?: string;
}

export interface RedisHealthResponse {
  status: 'ok' | 'error' | 'slow';
  responseTime: number;
  error?: string;
}
