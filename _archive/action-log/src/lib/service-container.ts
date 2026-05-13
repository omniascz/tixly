// =============================================================================
// Service container — DbAdapter + optional event bus (Kafka) pro action-log
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface EventBus {
  publish(topic: string, payload: Record<string, unknown>): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  eventBus?: EventBus;
}
