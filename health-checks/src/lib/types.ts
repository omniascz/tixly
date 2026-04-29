// Health check system — typy

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  responseTimeMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;           // overall = worst of all components
  version: string;
  environment: string;
  timestamp: string;              // ISO 8601
  uptimeSeconds: number;
  components: ComponentHealth[];
}

export interface HealthCheckOptions {
  timeoutMs?: number;             // per-check timeout (default: 3000)
  version?: string;
  environment?: string;
}

// Adapter interfaces (injected for testability)

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CacheAdapter {
  ping(): Promise<string>;        // should return 'PONG'
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

export interface HttpAdapter {
  get(url: string, timeoutMs?: number): Promise<{ status: number; ok: boolean }>;
}
