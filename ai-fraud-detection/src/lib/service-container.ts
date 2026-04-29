// =============================================================================
// Service container — dependency injection for ai-fraud-detection
// =============================================================================

export interface AiFraudDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface AiFraudKafka {
  send(topic: string, payload: Record<string, unknown>): Promise<void>;
}

export interface ServiceDeps {
  db: AiFraudDb;
  kafka: AiFraudKafka;
}

declare global {
  // eslint-disable-next-line no-var
  var _aiFraudDetectionDeps: ServiceDeps | undefined;
}

/**
 * Lazy singleton. In prod wires PgDbAdapter + HttpKafkaProducerAdapter.
 * Tests should inject their own deps directly into services instead of using this.
 */
export function getServiceDeps(): ServiceDeps {
  if (globalThis._aiFraudDetectionDeps) {
    return globalThis._aiFraudDetectionDeps;
  }

  // Dynamic import would normally wire real adapters here.
  // Intentionally throws if not initialized — callers should call initServiceDeps() first.
  throw new Error(
    'ai-fraud-detection service deps not initialized. Call initServiceDeps() at app boot.',
  );
}

export function initServiceDeps(deps: ServiceDeps): void {
  globalThis._aiFraudDetectionDeps = deps;
}
